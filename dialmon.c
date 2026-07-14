// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details
//
// dialmon — passive HCI monitor reader for the Microsoft Surface Dial.
//
// Opens the kernel HCI monitor channel (the same read-only, decrypted view of all HCI
// traffic that `btmon` uses) and emits line-delimited events on stdout. This lets
// dialserver receive the dial's input notifications the moment they arrive on air
// (~200 ms after a reconnect) instead of waiting ~1.35 s for BlueZ/kernel to rebuild the
// HID device. It is purely passive: it never touches the BlueZ-managed connection.
//
// Emitted events (one per line, flushed immediately):
//   C <MAC>          dial connected (from LE (Enhanced) Connection Complete)
//   D                dial disconnected (from Disconnection Complete)
//   N <hexpayload>   ATT notification on the input report handle (value bytes, hex)
//
// Usage:  dialmon [DIAL_MAC|auto] [inputHandleHex]
//   DIAL_MAC        e.g. 70:BC:10:87:BF:6F  (case-insensitive). "auto"/omitted: identify the
//                   dial purely by the input report handle (fine on a box with one BLE HID device);
//                   in that mode CONNECT is signalled on the first input rather than the LL connect.
//   inputHandleHex  ATT attribute handle of the input report, default 0x001a
//
// Must run with privileges to open the monitor socket (root / CAP_NET_RAW+CAP_NET_ADMIN).
// Requires no external libraries (Bluetooth structs are declared locally).

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>
#include <stdint.h>
#include <errno.h>
#include <sys/socket.h>

#ifndef AF_BLUETOOTH
#define AF_BLUETOOTH 31
#endif
#define BTPROTO_HCI          1
#define HCI_CHANNEL_MONITOR  2
#define HCI_DEV_NONE         0xffff

struct sockaddr_hci {
  unsigned short hci_family;
  unsigned short hci_dev;
  unsigned short hci_channel;
};

// Monitor packet header (little-endian), one per datagram, followed by `len` bytes.
struct mon_hdr {
  uint16_t opcode;
  uint16_t index;
  uint16_t len;
} __attribute__((packed));

// mon_hdr.opcode values we care about
#define MON_COMMAND_PKT 2
#define MON_EVENT_PKT   3
#define MON_ACL_TX_PKT  4
#define MON_ACL_RX_PKT  5

// HCI event codes
#define EVT_DISCONN_COMPLETE 0x05
#define EVT_LE_META          0x3e
// LE meta subevents
#define LE_CONN_COMPLETE     0x01
#define LE_ENH_CONN_COMPLETE 0x0a

// L2CAP fixed CID for ATT, and the ATT opcode for notifications
#define L2CAP_CID_ATT   0x0004
#define ATT_HANDLE_VALUE_NOTIFICATION 0x1b

static uint8_t  dial_addr[6];        // target dial, little-endian (as on the wire)
static int      have_target  = 0;    // 0 => identify by input handle only ("auto")
static uint16_t input_handle = 0x001a;
static int      announced    = -1;   // connection handle we've reported as CONNECTED (-1 = none)

// small handle -> peer-mac map so we can name the dial when announcing on first input
#define MAP_MAX 8
static struct { int handle; uint8_t mac[6]; } conn_map[MAP_MAX];

static void map_put(int handle, const uint8_t *mac) {
  for (int i = 0; i < MAP_MAX; i++) if (conn_map[i].handle == handle || conn_map[i].handle == 0) {
    conn_map[i].handle = handle; memcpy(conn_map[i].mac, mac, 6); return;
  }
  conn_map[0].handle = handle; memcpy(conn_map[0].mac, mac, 6);   // overflow: reuse slot 0
}
static const uint8_t *map_get(int handle) {
  for (int i = 0; i < MAP_MAX; i++) if (conn_map[i].handle == handle) return conn_map[i].mac;
  return NULL;
}

static void emit(const char *line) { fputs(line, stdout); fputc('\n', stdout); fflush(stdout); }

static void emit_connected(int handle) {
  announced = handle;
  const uint8_t *m = map_get(handle);
  char line[32];
  if (m) snprintf(line, sizeof(line), "C %02X:%02X:%02X:%02X:%02X:%02X",
                  m[5], m[4], m[3], m[2], m[1], m[0]);
  else   snprintf(line, sizeof(line), "C unknown");
  emit(line);
}

// parse "70:BC:10:87:BF:6F" into little-endian 6 bytes (b[0]=0x6F ... b[5]=0x70)
static int parse_mac(const char *s, uint8_t out[6]) {
  unsigned v[6];
  if (sscanf(s, "%x:%x:%x:%x:%x:%x", &v[0],&v[1],&v[2],&v[3],&v[4],&v[5]) != 6) return -1;
  for (int i = 0; i < 6; i++) out[i] = (uint8_t)v[5 - i];   // reverse to LE
  return 0;
}

static void handle_event(const uint8_t *p, int len) {
  if (len < 2) return;
  uint8_t code = p[0];
  const uint8_t *par = p + 2;              // skip event code + param length
  int plen = p[1];
  if (plen > len - 2) plen = len - 2;

  if (code == EVT_DISCONN_COMPLETE && plen >= 3) {
    int h = par[1] | (par[2] << 8);        // status, handle(2)
    if (h == announced) { announced = -1; emit("D"); }
    return;
  }

  if (code == EVT_LE_META && plen >= 1) {
    uint8_t sub = par[0];
    // Both variants: subevent, status, handle(2), role, peer_addr_type, peer_addr(6)
    if ((sub == LE_CONN_COMPLETE || sub == LE_ENH_CONN_COMPLETE) && plen >= 12) {
      uint8_t status = par[1];
      int h = par[2] | (par[3] << 8);
      const uint8_t *addr = par + 6;
      if (status != 0) return;
      map_put(h, addr);
      // With a known target we can announce CONNECTED at the LL connect (~30 ms). In "auto"
      // mode we wait for the first input instead (we can't tell which device is the dial yet).
      if (have_target && memcmp(addr, dial_addr, 6) == 0 && announced == -1)
        emit_connected(h);
    }
  }
}

static void handle_acl(const uint8_t *p, int len) {
  if (len < 4) return;
  int h = (p[0] | (p[1] << 8)) & 0x0fff;   // handle (12 bits) + flags
  // ACL header: handle+flags(2), dlen(2); then L2CAP: len(2), cid(2), payload
  const uint8_t *l2 = p + 4;
  int l2len = len - 4;
  if (l2len < 4) return;
  int cid = l2[2] | (l2[3] << 8);
  if (cid != L2CAP_CID_ATT) return;
  const uint8_t *att = l2 + 4;
  int attlen = l2len - 4;
  if (attlen < 3) return;
  if (att[0] != ATT_HANDLE_VALUE_NOTIFICATION) return;
  int attr = att[1] | (att[2] << 8);
  if (attr != input_handle) return;

  // Announce CONNECTED on the first input if we haven't already (covers "auto" mode and the
  // helper starting while the dial is already connected). Once announced, only accept input on
  // that same connection so a second BLE device can't inject on the same attribute handle.
  if (announced == -1) emit_connected(h);
  else if (h != announced) return;

  const uint8_t *val = att + 3;
  int vlen = attlen - 3;
  char line[8 + 2 * 64];
  int n = snprintf(line, sizeof(line), "N ");
  for (int i = 0; i < vlen && n < (int)sizeof(line) - 3; i++)
    n += snprintf(line + n, sizeof(line) - n, "%02x", val[i]);
  emit(line);
}

int main(int argc, char **argv) {
  if (argc >= 2 && strcasecmp(argv[1], "auto") != 0) {
    if (parse_mac(argv[1], dial_addr) != 0) {
      fprintf(stderr, "usage: %s [DIAL_MAC|auto] [inputHandleHex]\n", argv[0]);
      return 2;
    }
    have_target = 1;
  }
  if (argc >= 3) input_handle = (uint16_t)strtol(argv[2], NULL, 0);

  int fd = socket(AF_BLUETOOTH, SOCK_RAW, BTPROTO_HCI);
  if (fd < 0) { perror("socket(AF_BLUETOOTH)"); return 1; }

  struct sockaddr_hci addr;
  memset(&addr, 0, sizeof(addr));
  addr.hci_family  = AF_BLUETOOTH;
  addr.hci_dev     = HCI_DEV_NONE;
  addr.hci_channel = HCI_CHANNEL_MONITOR;
  if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
    perror("bind(HCI_CHANNEL_MONITOR)"); close(fd); return 1;
  }

  fprintf(stderr, "dialmon: watching %s handle 0x%04x\n",
          have_target ? argv[1] : "auto", input_handle);

  uint8_t buf[4096];
  for (;;) {
    ssize_t r = recv(fd, buf, sizeof(buf), 0);
    if (r < 0) {
      if (errno == EINTR) continue;
      perror("recv"); break;
    }
    if (r < (ssize_t)sizeof(struct mon_hdr)) continue;
    struct mon_hdr *mh = (struct mon_hdr *)buf;
    const uint8_t *payload = buf + sizeof(struct mon_hdr);
    int plen = (int)r - (int)sizeof(struct mon_hdr);
    if (mh->len < plen) plen = mh->len;

    switch (mh->opcode) {
      case MON_EVENT_PKT:  handle_event(payload, plen); break;
      case MON_ACL_RX_PKT: handle_acl(payload, plen);   break;
      default: break;
    }
  }
  close(fd);
  return 1;
}

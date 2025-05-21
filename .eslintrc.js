module.exports = {
  "env": {
    "browser": true,
    "es2021": true
  },
  "extends": [
    "eslint:recommended"
  ],
  "parserOptions": {
    "ecmaVersion": 12,
    "sourceType": "module"
  },
  "rules": {
    // Add or override rules here, e.g.:
    "semi": [
      "error",
      "never"
    ],
    "quotes": [
      "error",
      "single"
    ]
  }
}
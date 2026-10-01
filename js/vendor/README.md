# Vendored libraries

`qrcode.min.js` is `qrcodejs` 1.0.0 (MIT licence, davidshimjs/qrcodejs), copied unchanged from
`https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js`.

It draws the UPI QR code on the payment screen of `user.html`. It is hosted here so the payment
page does not depend on, or trust, a third-party server. `tests/user-page.test.mjs` checks the
file's SHA-256 so it cannot change by accident:

`C541EF06327885A8415BCA8DF6071E14189B4855336DEF4F36DB54BDE8484F36`

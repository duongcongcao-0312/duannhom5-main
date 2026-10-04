# duannhom5-main

BookNest is a Vietnamese bookstore website with a Node.js order API.

## Run locally

Requires Node.js 20 or newer.

```sh
npm start
```

Open http://127.0.0.1:8000. Orders are saved on the server in
`data/orders.jsonl`, which is excluded from Git because it contains customer
delivery information.

The order API validates the submitted books against the shared catalog and
calculates prices on the server. A successful checkout returns an order ID;
if saving fails, the checkout reports an error and keeps the cart.

This file-backed API is intended for local use and single-server deployments
with persistent disk storage. GitHub Pages only hosts static files and cannot
run the order API; production hosting also needs HTTPS, access controls for
order management, and a protected persistent database.

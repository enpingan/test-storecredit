const dotenv = require('dotenv').config();
const express = require('express');
const app = express();
const crypto = require('crypto');
const cookie = require('cookie');
const nonce = require('nonce')();
const querystring = require('querystring');
const request = require('request-promise');

const apiKey = process.env.SHOPIFY_API_KEY;
const apiSecret = process.env.SHOPIFY_API_SECRET;
const scopes = 'read_products, read_customers, write_customers';
const forwardingAddress = "https://3b310027.ngrok.io"; // Replace this with your HTTPS Forwarding address

var access_token = null;

app.listen(3000, () => {
  console.log('Test app listening on port 3000!');
});

app.get('/shopify', (req, res) => {
  const shop = req.query.shop;
  if (shop) {
    const state = nonce();
    const redirectUri = forwardingAddress + '/shopify/callback';
    const installUrl = 'https://' + shop +
      '/admin/oauth/authorize?client_id=' + apiKey +
      '&scope=' + scopes +
      '&state=' + state +
      '&redirect_uri=' + redirectUri;

    res.cookie('state', state);
    res.redirect(installUrl);
  } else {
    return res.status(400).send('Missing shop parameter. Please add ?shop=your-development-shop.myshopify.com to your request');
  }
});

app.get('/shopify/callback', (req, res) => {
  const { shop, hmac, code, state } = req.query;
  const stateCookie = cookie.parse(req.headers.cookie).state;

  if (state !== stateCookie) {
    return res.status(403).send('Request origin cannot be verified');
  }

  if (shop && hmac && code) {
    // DONE: Validate request is from Shopify
    const map = Object.assign({}, req.query);
    delete map['signature'];
    delete map['hmac'];
    const message = querystring.stringify(map);
    const providedHmac = Buffer.from(hmac, 'utf-8');
    const generatedHash = Buffer.from(
      crypto
        .createHmac('sha256', apiSecret)
        .update(message)
        .digest('hex'),
        'utf-8'
      );
    let hashEquals = false;

    try {
      hashEquals = crypto.timingSafeEqual(generatedHash, providedHmac)
    } catch (e) {
      hashEquals = false;
    };

    if (!hashEquals) {
      return res.status(400).send('HMAC validation failed');
    }

    // DONE: Exchange temporary code for a permanent access token
    const accessTokenRequestUrl = 'https://' + shop + '/admin/oauth/access_token';
    const accessTokenPayload = {
      client_id: apiKey,
      client_secret: apiSecret,
      code,
    };

    request.post(accessTokenRequestUrl, { json: accessTokenPayload })
      .then((accessTokenResponse) => {
        const accessToken = accessTokenResponse.access_token;
        access_token = accessToken;
        // DONE: Use access token to make API call to 'shop' endpoint
        const shopRequestUrl = 'https://' + shop + '/admin/api/2019-10/shop.json';
        const customersListUrl = 'https://' + shop + '/admin/api/2019-10/customers.json';
        const shopRequestHeaders = {
          'X-Shopify-Access-Token': accessToken,
        };

        request.get(customersListUrl, { headers: shopRequestHeaders })
          .then((customers) => {
            res.status(200).end(JSON.stringify(JSON.parse(customers), null, 3));
          })
          .catch((error) => {
            res.status(error.statusCode).send(error.error.error_description);
          });
    })
    .catch((error) => {
      res.status(error.statusCode).send(error.error.error_description);
    });

  } else {
    res.status(400).send('Access token is missing. Please go to the app homepage');
  }
});

// [GET] https://enpingan.myshopify.com/admin/apps/storecredit-1/store_credit/user/:id/balance
// Sample response
// {
//   customerId: 2560413401165,
//   storeCreditBalance: 125
// }
app.get('/store_credit/user/:id/balance', (req, res) => {
  const { shop, hmac } = req.query;
  const customerId = req.params.id;

  if (shop && hmac && access_token) {
    const customerUrl = 'https://' + shop + '/admin/api/2019-10/customers/' + customerId + '.json';
    const shopRequestHeaders = {
      'X-Shopify-Access-Token': access_token,
    };

    request.get(customerUrl, { headers: shopRequestHeaders })
      .then((customer) => {
        const c = JSON.parse(customer);
        res.status(200).end(JSON.stringify(
          { 
            customerId: c.customer.id,
            storeCreditBalance: isNaN(parseFloat(c.customer.note)) ? 150 : c.customer.note
          }, null, 3));
      })
      .catch((error) => {
        res.status(error.statusCode).send(error.error.error_description);
      });
  } else {
    res.status(400).send('Access token is missing. Please go to the app homepage');
  }
});

// [GET] https://enpingan.myshopify.com/admin/apps/storecredit-1/store_credit/user/:id/discount_code?item_ids=24,26
// Sample response
// {
//   discountCode: "Code",
//   discountAmount: $81.98
// }
app.get('/store_credit/user/:id/discount_code', (req, res) => {
  const { shop, hmac } = req.query;
  const customerId = req.params.id;
  var customer =  null;
  var currentBalance, discount_amount = 0;
  var item_ids = req.query.item_ids;

  if (shop && hmac && access_token) {
    const customerUrl = 'https://' + shop + '/admin/api/2019-10/customers/' + customerId + '.json';
    const shopRequestHeaders = {
      'X-Shopify-Access-Token': access_token,
    };

    // get customer by id
    request.get(customerUrl, { headers: shopRequestHeaders })
      .then((cus) => {
        // init variables
        customer = JSON.parse(cus);
        currentBalance = customer.customer.note;
        currentBalance = isNaN(currentBalance) ? 150 : currentBalance;

        // check total discount amount
        if (item_ids != undefined) {
          discount_amount = item_ids.split(",").reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
        }

        // handle current store credit balance
        if (currentBalance - discount_amount < 0) {
          currentBalance = 0;
        } else {
          currentBalance = currentBalance - discount_amount;
        }

        const customer_body = {
          customer: {
            id: customer.customer.id,
            email: customer.customer.email,
            note: currentBalance
          }
        }

        // update customer info
        request({ 
          url: customerUrl, 
          method: 'PUT', 
          headers: shopRequestHeaders,
          json: customer_body
        }, function (r, b, body) {
          res.status(200).end(JSON.stringify({
            discountCode: Math.floor(100000 + Math.random() * 900000),
            discountAmount: discount_amount
          }, null, 3));
        });
      })
      .catch((error) => {
        res.status(error.statusCode).send(error.error.error_description);
      });
  } else {
    res.status(400).send('Access token is missing. Please go to the app homepage');
  }
});
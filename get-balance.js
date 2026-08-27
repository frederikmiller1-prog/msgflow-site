// netlify/functions/get-balance.js
//
// Retrieves the current SMS credit balance from EasySendSMS.
// Uses the same EASYSENDSMS_API_KEY environment variable as send-sms.js.

const BALANCE_URL = 'https://restapi.easysendsms.app/v1/rest/sms/balance';

exports.handler = async function () {
  const apiKey = process.env.EASYSENDSMS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server misconfigured: missing EASYSENDSMS_API_KEY' }) };
  }

  try {
    const res = await fetch(BALANCE_URL, {
      method: 'POST',
      headers: {
        APIKEY: apiKey,
        'Content-Type': 'application/json',
        'Content-Length': '0',
      },
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && typeof data.balance !== 'undefined') {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, balance: data.balance }),
      };
    }

    return {
      statusCode: res.status || 500,
      body: JSON.stringify({ success: false, error: data.description || data.error || 'Unknown error from EasySendSMS' }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message || 'Request to EasySendSMS failed' }),
    };
  }
};

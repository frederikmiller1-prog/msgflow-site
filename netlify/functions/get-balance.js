const EASYSENDSMS_URL = 'https://restapi.easysendsms.app/v1/rest/sms/send';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body' }) };
  }

  const { to, message, sender_id } = payload;

  if (!to || !message || !sender_id) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing to, message or sender_id' }) };
  }

  const apiKey = process.env.EASYSENDSMS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server misconfigured: missing EASYSENDSMS_API_KEY' }) };
  }

  const isUnicode = /[^\x00-\x7F]/.test(message);

  const body = {
    from: sender_id,
    to: String(to).replace(/^\+/, '').replace(/[^0-9]/g, ''),
    text: message,
    type: isUnicode ? '1' : '0',
  };

  try {
    const res = await fetch(EASYSENDSMS_URL, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    const firstId = Array.isArray(data.messageIds) ? data.messageIds[0] : null;
    const ok = res.ok && data.status === 'OK' && firstId && firstId.startsWith('OK');

    if (ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message_id: firstId, status: 'sent' }),
      };
    }

    const errDetail =
      (Array.isArray(data.messageIds) && data.messageIds.find((m) => String(m).startsWith('ERR'))) ||
      data.description ||
      data.error ||
      'Unknown error from EasySendSMS';

    return {
      statusCode: res.ok ? 200 : res.status,
      body: JSON.stringify({ success: false, error: errDetail }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message || 'Request to EasySendSMS failed' }),
    };
  }
};

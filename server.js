require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Logger function
function logToFile(type, message, data = null) {
  const timestamp = new Date().toISOString();
  const logDate = timestamp.split('T')[0]; // YYYY-MM-DD format for the filename
  const logFilePath = path.join(logsDir, `${logDate}.log`);
  
  let logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
  if (data) {
    // If data is an object, stringify it
    if (typeof data === 'object') {
      logEntry += `\n${JSON.stringify(data, null, 2)}`;
    } else {
      logEntry += `\n${data}`;
    }
  }
  logEntry += '\n\n';
  
  // Append to log file
  fs.appendFile(logFilePath, logEntry, (err) => {
    if (err) {
      console.error('Error writing to log file:', err);
    }
  });
  
  // Also log to console for server-side visibility
  console.log(logEntry);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes with specific configuration
app.use(cors({
  origin: '*', // Allow requests from any origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON request body
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, '/')));

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoint for client-side logging
app.post('/api/log', (req, res) => {
  try {
    const { type, message, data } = req.body;
    
    if (!type || !message) {
      return res.status(400).json({
        success: false,
        message: 'Log type and message are required'
      });
    }
    
    // Log to file
    logToFile(type, message, data);
    
    res.json({
      success: true,
      message: 'Log entry created'
    });
  } catch (error) {
    console.error('Error creating log entry:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create log entry',
      error: error.message
    });
  }
});

// API proxy for login
app.post('/api/login', async (req, res) => {
  try {
    // Use credentials from .env file
    const loginData = {
      userNo: process.env.WMS_USER_NO,
      userPassword: process.env.WMS_USER_PASSWORD
    };

    logToFile('info', 'Attempting login to WMS API');

    const response = await axios.post(
      'https://botwebapi.istoreisend-wms.com/IsisWMS-War/Json/Public/login/',
      loginData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    // Extract cookies from response
    const cookies = response.headers['set-cookie'];
    
    if (!cookies || cookies.length === 0) {
      logToFile('error', 'No cookies returned from login response');
      return res.status(500).json({
        success: false,
        message: 'No session cookie returned from API'
      });
    }
    
    logToFile('info', 'Login successful', { cookies });
    
    // Return session data
    res.json({
      success: true,
      sessionCookie: cookies
    });
  } catch (error) {
    logToFile('error', 'Login error', { message: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to login to WMS API',
      error: error.message
    });
  }
});

// API proxy for order query
app.post('/api/query-order', async (req, res) => {
  try {
    const { orderName, sessionCookie } = req.body;

    if (!orderName) {
      return res.status(400).json({
        success: false,
        message: 'Order name is required'
      });
    }

    if (!sessionCookie) {
      return res.status(400).json({
        success: false,
        message: 'Session cookie is required'
      });
    }
    
    logToFile('info', 'Query order request received', { orderName });

    // Prepare cookie header - handle both string and array formats
    let cookieHeader = sessionCookie;
    if (Array.isArray(sessionCookie)) {
      cookieHeader = sessionCookie.join('; ');
    }
    
    // Prepare the request payload
    const requestPayload = {
      orderQuery: {
        courierServiceNo: "",
        trackingCode: "",
        custOrderNo: "",
        orderStatus: "",
        orderOrigin: "SHOPIFY",
        documentNo: orderName,
        orderBy: "documentNo"
      },
      pageData: {
        currentLength: 10,
        currentOffset: 0
      }
    };
    
    logToFile('info', 'Sending request payload', requestPayload);
    
    let response;
    try {
      response = await axios.post(
        'https://botwebapi.istoreisend-wms.com/IsisWMS-War/Json/WhseOrder/doQueryOrderPage',
        requestPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Cookie': cookieHeader
          }
        }
      );
      
      logToFile('info', 'Response received', {
        status: response.status,
        headers: response.headers
      });
    } catch (error) {
      logToFile('error', 'Error making request to WMS API', {
        message: error.message,
        response: error.response ? {
          status: error.response.status,
          data: error.response.data
        } : 'No response'
      });
      throw error;
    }

    const data = response.data;
    logToFile('info', 'WMS API response data', data);
    
    // The API response structure is different than we expected
    // It has returnObject.currentPageData instead of orderList
    if (!data.returnObject || !data.returnObject.currentPageData || data.returnObject.currentPageData.length === 0) {
      logToFile('warn', 'No orders found in response data');
      return res.status(404).json({
        success: false,
        message: 'No orders found with that Shopify order name'
      });
    }
    
    // Extract the first order from the currentPageData array
    const order = data.returnObject.currentPageData[0];
    logToFile('info', 'Found order', order);
    
    // Get the tracking code from the order
    const trackingCode = order.trackingCode;
    if (!trackingCode) {
      logToFile('warn', 'No tracking code found for this order', { orderName });
      return res.status(404).json({
        success: false,
        message: 'No tracking code found for this order'
      });
    }
    
    logToFile('info', 'Found tracking code', { orderName, trackingCode });
    
    res.json({
      success: true,
      trackingCode
    });
  } catch (error) {
    logToFile('error', 'Order query error', { message: error.message });
    
    // Provide more detailed error information
    let statusCode = 500;
    let errorMessage = 'Failed to query order';
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      logToFile('error', 'Error response details', {
        data: error.response.data,
        status: error.response.status
      });
      
      statusCode = error.response.status;
      errorMessage = `API responded with status ${error.response.status}: ${error.message}`;
    } else if (error.request) {
      // The request was made but no response was received
      logToFile('error', 'No response received from API server');
      errorMessage = 'No response received from API server';
    } else {
      // Something happened in setting up the request that triggered an Error
      logToFile('error', 'Error setting up request', { message: error.message });
      errorMessage = error.message;
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: error.message
    });
  }
});

// Start the server
app.listen(PORT, () => {
  logToFile('info', `Server running on port ${PORT}`);
  console.log(`Server running on port ${PORT}`);
});

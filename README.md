# Order Tracking System

This project provides an order tracking system that can be integrated with Shopify. It allows customers to track their orders using their Shopify order name (e.g., TMR-O12345). The system connects to the iStore iSend WMS API to retrieve real-time order status information.

## Project Structure

The project is organized into two main parts:

### 1. Frontend

The `frontend` directory contains files that can be embedded in your Shopify site:

- `tracking-page.html`: HTML template that can be used as a reference for your Shopify page
- `tracking.js`: JavaScript file that handles the tracking functionality
- `style.css`: CSS styles for the tracking interface

### 2. Backend

The `backend` directory contains the server-side code that should be deployed to your Bluehost server:

- `server.js`: Node.js Express server that handles API requests and logging
- `package.json`: Dependencies and scripts for the backend
- `.env`: Environment variables (credentials, etc.)
- `public/`: Directory containing static files to be served by the backend

## Deployment Instructions

### Deploying the Backend to Bluehost

1. Upload the entire `backend` directory to your Bluehost server

2. Install Node.js on your Bluehost server if it's not already installed

3. Navigate to the backend directory and install dependencies:
   ```
   cd /path/to/backend
   npm install
   ```

4. Update the `.env` file with your WMS API credentials:
   ```
   WMS_USERNAME=your_username
   WMS_PASSWORD=your_password
   PORT=3000
   ```

5. Set up a process manager like PM2 to keep your Node.js application running:
   ```
   npm install -g pm2
   pm2 start server.js --name "tracking-backend"
   pm2 save
   ```

6. Configure your Bluehost domain to point to your Node.js application. You may need to set up a reverse proxy using Apache or Nginx.

### Integrating with Shopify

1. In your Shopify admin, go to "Online Store" > "Themes" > "Customize"

2. Create a new page template for the tracking page

3. Add the HTML from `frontend/tracking-page.html` to your new page template

4. Update the URLs in the HTML to point to your Bluehost server:
   - Change `https://your-bluehost-domain.com/tracking/style.css` to your actual domain
   - Change `https://your-bluehost-domain.com/tracking/tracking.js` to your actual domain

5. Update the API endpoints in `tracking.js` to point to your Bluehost server:
   - Change all instances of `https://your-bluehost-domain.com/api/...` to your actual domain

6. Upload the modified `tracking.js` to your Bluehost server in the `backend/public` directory

## Important Notes

1. **CORS Configuration**: Make sure to update the CORS configuration in `server.js` to include your Shopify store domain:
   ```javascript
   app.use(cors({
       origin: ['https://your-shopify-store.myshopify.com'],
       credentials: true
   }));
   ```

2. **Security**: The `.env` file contains sensitive information. Make sure it's not accessible from the web.

3. **Logging**: All logs are stored in the `logs` directory on your Bluehost server. These logs include API requests, errors, and user interactions.

4. **Session Management**: The application stores session cookies in the user's browser localStorage with a 24-hour expiration to minimize unnecessary login requests to the WMS API.

## Testing

You can test the backend independently by:

1. Starting the server locally:
   ```
   cd backend
   npm run dev
   ```

2. Opening `http://localhost:3000` in your browser

3. Entering a tracking number or Shopify order name

## Troubleshooting

- If tracking doesn't work, check the server logs in the `logs` directory
- Verify that your WMS API credentials are correct in the `.env` file
- Make sure the CORS configuration includes your Shopify domain
- Check that all API endpoints in `tracking.js` are correctly pointing to your Bluehost domain

## API Documentation

### 1. Login API

```
POST https://botwebapi.istoreisend-wms.com/IsisWMS-War/Json/Public/login/
Content-Type: application/json

{
  "userNo": "WMS username",
  "userPassword": "WMS Password"
}
```

This endpoint authenticates with the WMS system and returns a session cookie that must be used for subsequent requests.

### 2. Order Query API

```
POST https://botwebapi.istoreisend-wms.com/IsisWMS-War/Json/WhseOrder/doQueryOrderPage
Content-Type: application/json

{
    "orderQuery": {
        "courierServiceNo": "",
        "trackingCode": "",
        "custOrderNo": "",
        "orderStatus": "",
        "orderOrigin": "SHOPIFY",
        "documentNo": "#1234",
        "orderBy": "custOrderNo"
    },
    "pageData": {
        "currentLength": 10,
        "currentOffset": 0
    }
}
```

This endpoint retrieves order information using the Shopify order number.

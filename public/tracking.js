/**
 * Order Tracking System
 * This script handles the order tracking functionality for the Shopify store.
 */

class Logger {
    constructor() {
        this.levels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3
        };
        this.currentLevel = this.levels.info; // Default to info level
        this.consoleOutput = true; // Enable console output
    }

    async log(type, message, data = {}) {
        // Only log if the level is high enough
        if (this.levels[type] < this.currentLevel) return;
        
        // Send log to server
        try {
            await fetch('/api/log', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type,
                    message,
                    data
                })
            });
        } catch (error) {
            // Don't let logging failures cause client-side errors
            if (this.consoleOutput) {
                console.error('Failed to send log to server:', error);
            }
        }

        // Also log to console if enabled
        if (this.consoleOutput) {
            const timestamp = new Date().toISOString();
            const prefix = `[${timestamp}] [${type.toUpperCase()}]`;
            
            switch (type) {
                case 'debug':
                    console.debug(prefix, message, data);
                    break;
                case 'info':
                    console.info(prefix, message, data);
                    break;
                case 'warn':
                    console.warn(prefix, message, data);
                    break;
                case 'error':
                    console.error(prefix, message, data);
                    break;
                default:
                    console.log(prefix, message, data);
            }
        }
    }

    debug(message, data = {}) {
        return this.log('debug', message, data);
    }

    info(message, data = {}) {
        return this.log('info', message, data);
    }

    warn(message, data = {}) {
        return this.log('warn', message, data);
    }

    error(message, data = {}) {
        return this.log('error', message, data);
    }

    setLevel(level) {
        if (this.levels[level] !== undefined) {
            this.currentLevel = this.levels[level];
            this.info(`Log level set to ${level}`);
        } else {
            this.error(`Invalid log level: ${level}`);
        }
    }
}

// Create a global logger instance
const logger = new Logger();

/**
 * Login to the WMS API
 * @returns {Promise<string>} Session cookie for authenticated requests
 */
async function loginToWMS() {
    try {
        // Check if we have a valid session cookie in localStorage
        const savedSession = localStorage.getItem('wmsSession');
        if (savedSession) {
            const sessionData = JSON.parse(savedSession);
            const expiryTime = new Date(sessionData.expiry);
            
            // If session is still valid, use it
            if (expiryTime > new Date()) {
                logger.info('Using existing session cookie', {
                    expiry: sessionData.expiry,
                    timeRemaining: Math.floor((expiryTime - new Date()) / 1000 / 60) + ' minutes'
                });
                return sessionData.cookie;
            }
            
            logger.info('Session cookie expired, logging in again', {
                expiry: sessionData.expiry
            });
        } else {
            logger.info('No session cookie found, logging in...');
        }
        
        const response = await fetch('https://botwebapi.istoreisend-wms.com/IsisWMS-War/Json/Public/login/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userNo: 'BOT1545',
                userPassword: '24c82fd32c664e073a414f78d06976a3'
            })
        });
        
        if (!response.ok) {
            throw new Error(`Login failed with status: ${response.status}`);
        }
        
        const data = await response.json();
        logger.info('Login successful', { userId: data.userId || 'unknown' });
        
        // Get the session cookie from the response headers
        const cookies = response.headers.get('set-cookie');
        if (!cookies) {
            throw new Error('No cookies received from login response');
        }
        
        // Save the session cookie to localStorage with 24-hour expiry
        const expiry = new Date();
        expiry.setHours(expiry.getHours() + 24);
        
        localStorage.setItem('wmsSession', JSON.stringify({
            cookie: cookies,
            expiry: expiry.toISOString()
        }));
        
        logger.info('Session cookie saved', {
            expiry: expiry.toISOString()
        });
        
        return cookies;
    } catch (error) {
        logger.error('Login failed', { error: error.message, stack: error.stack });
        throw error;
    }
}

/**
 * Query an order by its Shopify order name
 * @param {string} orderName - The Shopify order name (e.g., TMR-O12345)
 * @param {string} sessionCookie - The session cookie from loginToWMS
 * @returns {Promise<Object>} Order details
 */
async function queryOrderByShopifyName(orderName, sessionCookie) {
    try {
        logger.info('Querying order by Shopify name', {
            orderName,
            sessionCookie: sessionCookie ? 'provided' : 'missing',
            length: Array.isArray(sessionCookie) ? sessionCookie.length : 'N/A'
        });
        
        const response = await fetch('https://botwebapi.istoreisend-wms.com/IsisWMS-War/Json/WhseOrder/doQueryOrderPage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': sessionCookie
            },
            body: JSON.stringify({
                orderQuery: {
                    courierServiceNo: "",
                    trackingCode: "",
                    custOrderNo: "",
                    orderStatus: "",
                    orderOrigin: "SHOPIFY",
                    documentNo: orderName,
                    orderBy: "custOrderNo"
                },
                pageData: {
                    currentLength: 10,
                    currentOffset: 0
                }
            })
        });
        
        if (!response.ok) {
            throw new Error(`Order query failed with status: ${response.status}`);
        }
        
        const data = await response.json();
        logger.info('Order query successful', {
            orderCount: data.orders?.length || 0,
            firstOrderId: data.orders?.[0]?.id || 'none'
        });
        
        return data;
    } catch (error) {
        logger.error('Order query failed', { error: error.message, stack: error.stack, orderName });
        throw error;
    }
}

/**
 * Track an order using its Shopify order name
 * @param {string} orderName - The Shopify order name to track
 */
async function trackOrder(orderName) {
    try {
        // Format the order name if needed
        const formattedOrderName = formatShopifyOrderName(orderName);
        logger.info('Tracking order', { originalOrderName: orderName, formattedOrderName });
        
        // Show loading state
        const statusDisplay = document.getElementById('currentStatus');
        if (statusDisplay) {
            statusDisplay.textContent = 'Looking up your order...';
            statusDisplay.style.color = '#17406d';
        }
        
        // Reset timeline steps
        const timelineSteps = document.querySelectorAll('.status-step');
        timelineSteps.forEach(step => {
            step.classList.remove('active', 'completed');
        });
        
        // Reset detailed timeline
        const timelineStepsDetailed = document.getElementById('timelineStepsDetailed');
        if (timelineStepsDetailed) {
            timelineStepsDetailed.innerHTML = '<li><i class="fas fa-spinner fa-spin timeline-detail-icon"></i> Connecting to tracking system...</li>';
        }
        
        // Login to the WMS API
        const sessionCookie = await loginToWMS();
        
        // Query the order
        const orderData = await queryOrderByShopifyName(formattedOrderName, sessionCookie);
        
        // Process the order data
        if (orderData.orders && orderData.orders.length > 0) {
            const order = orderData.orders[0];
            logger.info('Order found', { orderId: order.id, status: order.status });
            
            // Update the UI with order status
            updateOrderStatusUI(order);
            
            // Update URL with tracking parameter for sharing
            updateURLWithTracking(formattedOrderName);
            
            // Show sharing options
            const shareContainer = document.getElementById('shareContainer');
            if (shareContainer) {
                shareContainer.style.display = 'block';
            }
        } else {
            logger.warn('Order not found', { orderName: formattedOrderName });
            
            // Update UI for order not found
            if (statusDisplay) {
                statusDisplay.textContent = 'Order not found';
                statusDisplay.style.color = '#e12c7b';
            }
            
            if (timelineStepsDetailed) {
                timelineStepsDetailed.innerHTML = `
                    <li><i class="fas fa-exclamation-circle timeline-detail-icon"></i> 
                    <strong>Order Not Found</strong>: We couldn't find an order with the number "${formattedOrderName}". Please check the order number and try again.</li>
                `;
            }
            
            // Hide sharing options
            const shareContainer = document.getElementById('shareContainer');
            if (shareContainer) {
                shareContainer.style.display = 'none';
            }
        }
    } catch (error) {
        logger.error('Error tracking order', { error: error.message, stack: error.stack, orderName });
        
        // Update UI for error
        const currentStatusDisplay = document.getElementById('currentStatus');
        const timelineStepsDetailed = document.getElementById('timelineStepsDetailed');
        const shareContainer = document.getElementById('shareContainer');
        
        if (currentStatusDisplay) {
            currentStatusDisplay.textContent = 'Error: Could not retrieve tracking information';
            currentStatusDisplay.style.color = '#e12c7b';
        }
        
        if (timelineStepsDetailed) {
            timelineStepsDetailed.innerHTML = `
                <li><i class="fas fa-exclamation-circle timeline-detail-icon"></i> 
                <strong>Error</strong>: ${error.message || 'Please check your input and try again.'}</li>
            `;
        }
        
        if (shareContainer) {
            shareContainer.style.display = 'none';
        }
    }
}

/**
 * Update the UI with order status information
 * @param {Object} order - The order data from the API
 */
function updateOrderStatusUI(order) {
    // Map WMS status to our status steps
    const statusMapping = {
        'CREATED': 0,         // Order Received
        'RELEASED': 1,        // Processing
        'PICKING': 1,         // Processing
        'PICKED': 1,          // Processing
        'PACKING': 2,         // Packing
        'PACKED': 2,          // Packing
        'MANIFESTED': 3,      // Shipped
        'DISPATCHED': 3,      // Shipped
        'DELIVERED': 4        // Delivered
    };
    
    // Get the current status index (default to 0 if not found)
    const currentStatusIndex = statusMapping[order.status] || 0;
    
    // Update the current status text
    const currentStatusDisplay = document.getElementById('currentStatus');
    if (currentStatusDisplay) {
        currentStatusDisplay.textContent = getStatusText(currentStatusIndex);
        currentStatusDisplay.style.color = '#17406d';
    }
    
    // Update the timeline steps
    const timelineSteps = document.querySelectorAll('.status-step');
    timelineSteps.forEach((step, index) => {
        if (index < currentStatusIndex) {
            // Steps before current are completed
            step.classList.add('completed');
            step.classList.remove('active');
        } else if (index === currentStatusIndex) {
            // Current step is active
            step.classList.add('active');
            step.classList.remove('completed');
        } else {
            // Future steps are neither active nor completed
            step.classList.remove('active', 'completed');
        }
    });
    
    // Update the status line
    const statusLine = document.getElementById('statusLine');
    if (statusLine) {
        // Calculate width based on current status (0-4 maps to 0-100%)
        const progressPercent = (currentStatusIndex / (timelineSteps.length - 1)) * 100;
        statusLine.style.width = `${progressPercent}%`;
    }
    
    // Update detailed timeline
    const timelineStepsDetailed = document.getElementById('timelineStepsDetailed');
    if (timelineStepsDetailed) {
        const details = [];
        
        // Add order received step
        details.push(`
            <li>
                <i class="${currentStatusIndex >= 0 ? 'fas fa-check-circle' : 'far fa-circle'} timeline-detail-icon"></i>
                <strong>Order Received</strong>: Your order #${order.documentNo} was received on ${formatDate(order.createdDate)}.
            </li>
        `);
        
        // Add processing step
        details.push(`
            <li>
                <i class="${currentStatusIndex >= 1 ? 'fas fa-check-circle' : currentStatusIndex === 1 ? 'fas fa-spinner fa-spin' : 'far fa-circle'} timeline-detail-icon"></i>
                <strong>Processing</strong>: ${currentStatusIndex >= 1 ? 'Your order is being prepared for packing.' : 'Waiting for processing to begin.'}
            </li>
        `);
        
        // Add packing step
        details.push(`
            <li>
                <i class="${currentStatusIndex >= 2 ? 'fas fa-check-circle' : currentStatusIndex === 2 ? 'fas fa-spinner fa-spin' : 'far fa-circle'} timeline-detail-icon"></i>
                <strong>Packing</strong>: ${currentStatusIndex >= 2 ? 'Your items have been packed and are ready for shipping.' : 'Waiting for packing to begin.'}
            </li>
        `);
        
        // Add shipped step
        details.push(`
            <li>
                <i class="${currentStatusIndex >= 3 ? 'fas fa-check-circle' : currentStatusIndex === 3 ? 'fas fa-spinner fa-spin' : 'far fa-circle'} timeline-detail-icon"></i>
                <strong>Shipped</strong>: ${currentStatusIndex >= 3 ? `Your order was shipped on ${formatDate(order.dispatchedDate || new Date())}${order.trackingCode ? ` with tracking number: ${order.trackingCode}` : ''}.` : 'Waiting for shipment.'}
            </li>
        `);
        
        // Add delivered step
        details.push(`
            <li>
                <i class="${currentStatusIndex >= 4 ? 'fas fa-check-circle' : currentStatusIndex === 4 ? 'fas fa-spinner fa-spin' : 'far fa-circle'} timeline-detail-icon"></i>
                <strong>Delivered</strong>: ${currentStatusIndex >= 4 ? `Your order was delivered on ${formatDate(order.deliveredDate || new Date())}.` : 'Waiting for delivery.'}
            </li>
        `);
        
        timelineStepsDetailed.innerHTML = details.join('');
    }
}

/**
 * Get the text representation of a status index
 * @param {number} statusIndex - The status index (0-4)
 * @returns {string} The status text
 */
function getStatusText(statusIndex) {
    const statusTexts = [
        'Order Received',
        'Processing',
        'Packing',
        'Shipped',
        'Delivered'
    ];
    
    return statusTexts[statusIndex] || 'Unknown Status';
}

/**
 * Format a date string or object into a readable format
 * @param {string|Date} dateStr - The date to format
 * @returns {string} The formatted date
 */
function formatDate(dateStr) {
    if (!dateStr) return 'Unknown Date';
    
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Invalid Date';
    
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Update the URL with the tracking parameter for sharing
 * @param {string} orderName - The order name to add to the URL
 */
function updateURLWithTracking(orderName) {
    const url = new URL(window.location.href);
    url.searchParams.set('tracking', orderName);
    window.history.replaceState({}, '', url.toString());
}

/**
 * Format Shopify order names if needed
 * @param {string} orderName - The order name to format
 * @returns {string} The formatted order name
 */
function formatShopifyOrderName(orderName) {
    if (!orderName) return orderName;
    
    // Convert to uppercase for consistent comparison
    const upperOrderName = orderName.toUpperCase();
    
    // If it starts with TMR- but not TMR-O, add the O
    if (upperOrderName.startsWith('TMR-') && !upperOrderName.startsWith('TMR-O')) {
        return orderName.replace(/^TMR-/i, 'TMR-O');
    }
    
    return orderName;
}

// Initialize when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', async function() {
    // Set up form submission handler
    const trackingForm = document.getElementById('trackingForm');
    if (trackingForm) {
        trackingForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            const orderNumber = document.getElementById('orderNumber').value.trim();
            await trackOrder(orderNumber);
        });
    }
    
    // Set up copy link button functionality
    const copyTrackingLink = document.getElementById('copyTrackingLink');
    if (copyTrackingLink) {
        copyTrackingLink.addEventListener('click', function() {
            const currentUrl = window.location.href;
            navigator.clipboard.writeText(currentUrl).then(() => {
                const notification = document.getElementById('copyNotification');
                if (notification) {
                    notification.classList.add('show');
                    
                    setTimeout(() => {
                        notification.classList.remove('show');
                    }, 3000);
                }
            }).catch(err => {
                console.error('Could not copy text: ', err);
                alert('Failed to copy the link. Please try again.');
            });
        });
    }
    
    // Check for URL parameters on page load
    const urlParams = new URLSearchParams(window.location.search);
    const trackingParam = urlParams.get('tracking');
    
    if (trackingParam) {
        // Set the input field value to what was in the URL
        const orderNumberInput = document.getElementById('orderNumber');
        if (orderNumberInput) {
            orderNumberInput.value = trackingParam;
        }
        
        // Track the order using the parameter from the URL
        await trackOrder(trackingParam);
    }
});

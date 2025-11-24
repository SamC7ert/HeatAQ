/**
 * HeatAQ API Communication Layer
 * Centralized API requests with authentication
 */

const API = {
    /**
     * GET request
     */
    async get(endpoint, params = {}) {
        const url = new URL(CONFIG.API_BASE_URL, window.location.origin);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders()
            });

            return await this.handleResponse(response);

        } catch (error) {
            return this.handleError(error);
        }
    },

    /**
     * POST request
     */
    async post(data) {
        try {
            const response = await fetch(CONFIG.API_BASE_URL, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(data)
            });

            return await this.handleResponse(response);

        } catch (error) {
            return this.handleError(error);
        }
    },

    /**
     * Get request headers with authentication
     */
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };

        const sessionId = localStorage.getItem('session_id');
        if (sessionId) {
            headers['X-Session-ID'] = sessionId;
        }

        return headers;
    },

    /**
     * Handle API response
     */
    async handleResponse(response) {
        if (response.status === 401) {
            // Session expired, redirect to login
            this.handleUnauthorized();
            throw new Error('Session expired');
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }

        return data;
    },

    /**
     * Handle errors
     */
    handleError(error) {
        console.error('API Error:', error);

        if (CONFIG.debugMode) {
            console.error(error.stack);
        }

        // Show user-friendly error message
        UI.showToast(error.message || 'An error occurred', 'error');

        throw error;
    },

    /**
     * Handle unauthorized (401) responses
     */
    handleUnauthorized() {
        localStorage.clear();
        window.location.href = 'login.html';
    }
};

/**
 * UI Helper Functions
 */
const UI = {
    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);

        // Remove after duration
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, CONFIG.TOAST_DURATION);
    },

    /**
     * Show loading state
     */
    showLoading(element) {
        if (element) {
            element.innerHTML = '<p class="loading">Loading...</p>';
        }
    },

    /**
     * Show error state
     */
    showError(element, message) {
        if (element) {
            element.innerHTML = `<p class="error">${message}</p>`;
        }
    }
};

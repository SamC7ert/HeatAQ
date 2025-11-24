/**
 * HeatAQ Application Bootstrap
 * Initialize and coordinate all modules
 */

const App = {
    userContext: null,

    /**
     * Initialize application
     */
    async init() {
        console.log('Initializing HeatAQ...');

        // Check if user is logged in
        if (!this.checkAuth()) {
            window.location.href = 'login.html';
            return;
        }

        // Load user context
        this.loadUserContext();

        // Initialize navigation
        Navigation.init();

        // Set up event handlers
        this.setupEventHandlers();

        // Load initial section
        Navigation.switchSection('day-schedules');

        console.log('HeatAQ initialized successfully');
    },

    /**
     * Check if user is authenticated
     */
    checkAuth() {
        const sessionId = localStorage.getItem('session_id');
        return !!sessionId;
    },

    /**
     * Load user context from localStorage
     */
    loadUserContext() {
        this.userContext = {
            sessionId: localStorage.getItem('session_id'),
            userName: localStorage.getItem('user_name'),
            projectName: localStorage.getItem('project_name'),
            siteId: localStorage.getItem('site_id'),
            role: localStorage.getItem('role')
        };

        // Update UI with user info
        const projectNameEl = document.getElementById('project-name');
        if (projectNameEl) {
            projectNameEl.textContent = this.userContext.projectName || 'No Project';
        }

        const userNameEl = document.getElementById('user-name');
        if (userNameEl) {
            userNameEl.textContent = this.userContext.userName || 'User';
        }

        const userRoleEl = document.getElementById('user-role');
        if (userRoleEl) {
            userRoleEl.textContent = this.userContext.role || 'viewer';
            userRoleEl.className = `role-badge role-${this.userContext.role}`;
        }
    },

    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        // Logout button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }

        // Save button
        const saveBtn = document.getElementById('save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveChanges());
        }

        // Add schedule buttons
        const addDayBtn = document.getElementById('add-day-schedule');
        if (addDayBtn) {
            addDayBtn.addEventListener('click', () => {
                UI.showToast('Add day schedule functionality to be implemented', 'info');
            });
        }

        const addWeekBtn = document.getElementById('add-week-schedule');
        if (addWeekBtn) {
            addWeekBtn.addEventListener('click', () => {
                UI.showToast('Add week schedule functionality to be implemented', 'info');
            });
        }

        // Test date button
        const testBtn = document.getElementById('test-date-btn');
        if (testBtn) {
            testBtn.addEventListener('click', () => this.testScheduleResolution());
        }
    },

    /**
     * Logout user
     */
    async logout() {
        try {
            const sessionId = localStorage.getItem('session_id');

            // Call logout API
            await fetch(CONFIG.LOGIN_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'logout',
                    session_id: sessionId
                })
            });

        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Clear local storage and redirect
            localStorage.clear();
            window.location.href = 'login.html';
        }
    },

    /**
     * Save changes (placeholder)
     */
    saveChanges() {
        UI.showToast('Save functionality to be implemented', 'info');
    },

    /**
     * Test schedule resolution
     */
    async testScheduleResolution() {
        const dateInput = document.getElementById('test-date');
        const resultDiv = document.getElementById('test-result');

        if (!dateInput.value) {
            UI.showToast('Please select a date', 'error');
            return;
        }

        resultDiv.innerHTML = '<p class="loading">Testing...</p>';

        try {
            const response = await API.get('', {
                action: 'test_schedule_resolution',
                date: dateInput.value
            });

            if (response.success) {
                resultDiv.innerHTML = `
                    <div class="result-success">
                        <h4>Schedule Resolution Result</h4>
                        <p><strong>Date:</strong> ${response.data.date}</p>
                        <p><strong>Resolved Schedule:</strong> ${response.data.resolved_schedule}</p>
                        <p><strong>Source:</strong> ${response.data.source}</p>
                        <p class="note">${response.data.message}</p>
                    </div>
                `;
            }

        } catch (error) {
            resultDiv.innerHTML = `<p class="error">Failed to test schedule: ${error.message}</p>`;
        }
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

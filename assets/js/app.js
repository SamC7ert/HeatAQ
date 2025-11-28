// Main Application Controller

const app = {
    // Initialize the application
    async init() {
        console.log('Initializing HeatAQ Schedule Management...');

        // Set version displays from config
        this.setVersion();

        // Initialize navigation
        this.navigation.init();

        // Set up global event handlers
        this.setupEventHandlers();

        // Load initial data
        await this.schedules.init();

        console.log('Application initialized successfully');
    },

    // Set version displays from config
    setVersion() {
        const version = config.APP_VERSION || 'V??';
        const headerEl = document.getElementById('header-version');
        const sysEl = document.getElementById('sys-app-version');
        if (headerEl) headerEl.textContent = version;
        if (sysEl) sysEl.textContent = version;
    },
    
    // Setup global event handlers
    setupEventHandlers() {
        // Prevent form submission on Enter key
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.preventDefault();
            }
        });
        
        // Handle window resize
        window.addEventListener('resize', () => {
            this.handleResize();
        });
    },
    
    // Handle window resize
    handleResize() {
        // Add any responsive behavior here
        const width = window.innerWidth;
        if (width < 768) {
            // Mobile view adjustments
            document.body.classList.add('mobile');
        } else {
            document.body.classList.remove('mobile');
        }
    },
    
    // Tab management
    tabs: {
        current: 'day',
        
        switch(tabName) {
            // Update tab buttons
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Update tab content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            // Activate selected tab
            const clickedBtn = event?.target;
            if (clickedBtn) {
                clickedBtn.classList.add('active');
            }
            
            const targetTab = document.getElementById(tabName + '-tab');
            if (targetTab) {
                targetTab.classList.add('active');
                this.current = tabName;
            }
            
            // Load tab-specific data
            this.loadTabData(tabName);
        },
        
        async loadTabData(tabName) {
            switch (tabName) {
                case 'day':
                    await app.schedules.loadDaySchedules();
                    break;
                    
                case 'week':
                    // FIX: This was missing - now properly loading week schedules
                    await app.schedules.loadWeekSchedules();
                    break;
                    
                case 'calendar':
                    await app.calendar.loadCalendarRules(app.schedules.currentTemplate);
                    break;
            }
        },
        
        getCurrent() {
            return this.current;
        }
    },
    
    // Global actions
    actions: {
        async save() {
            const currentSection = app.navigation.getCurrentSection();
            
            if (currentSection !== 'schedules') {
                api.utils.showError('Save only available for schedules');
                return;
            }
            
            // TODO: Implement save functionality based on current tab
            const currentTab = app.tabs.getCurrent();
            console.log('Saving changes for tab:', currentTab);
            
            api.utils.showError('Save functionality not yet fully implemented');
        },
        
        async refresh() {
            const currentSection = app.navigation.getCurrentSection();
            
            switch (currentSection) {
                case 'schedules':
                    await app.schedules.init();
                    break;
                default:
                    console.log('Refreshing:', currentSection);
            }
        }
    },
    
    // Expose modules
    navigation: navigation,
    schedules: schedules,
    calendar: calendar,
    simulations: typeof SimulationsModule !== 'undefined' ? SimulationsModule : null,
    simcontrol: typeof SimControlModule !== 'undefined' ? SimControlModule : null,
    configuration: typeof ConfigurationModule !== 'undefined' ? ConfigurationModule : null,
    admin: typeof AdminModule !== 'undefined' ? AdminModule : null,
    project: typeof ProjectModule !== 'undefined' ? ProjectModule : null,
    api: api,
    config: config
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    app.init().catch(error => {
        console.error('Failed to initialize application:', error);
        document.body.innerHTML = `
            <div style="padding: 50px; text-align: center;">
                <h2>Failed to Initialize Application</h2>
                <p style="color: red;">${error.message}</p>
                <p>Please check the console for more details.</p>
            </div>
        `;
    });
});

// Make app globally available
window.app = app;

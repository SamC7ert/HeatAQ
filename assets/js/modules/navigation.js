// Navigation module - Handles section switching and menu state

const navigation = {
    currentSection: 'schedules',
    
    init() {
        // Set initial active state
        this.switchSection('schedules', false);
    },
    
    switchSection(sectionName, updateUI = true) {
        // Hide all sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });
        
        // Show selected section
        const targetSection = document.getElementById(sectionName + '-section');
        if (targetSection) {
            targetSection.classList.add('active');
            this.currentSection = sectionName;
        }
        
        // Update navigation menu
        if (updateUI) {
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Find and activate the clicked nav item
            const clickedItem = event?.currentTarget;
            if (clickedItem) {
                clickedItem.classList.add('active');
            }
        }
        
        // Update header title
        const titles = {
            'schedules': 'Schedule Configuration',
            'scenarios': 'Scenario Management',
            'configurations': 'System Configuration',
            'reports': 'Reports',
            'simulations': 'Run Simulations'
        };
        
        const titleElement = document.getElementById('section-title');
        if (titleElement) {
            titleElement.textContent = titles[sectionName] || sectionName;
        }
        
        // Load section-specific data if needed
        this.loadSectionData(sectionName);
    },

    loadSectionData(sectionName) {
        switch (sectionName) {
            // PROJECT sections
            case 'dashboard':
                if (typeof app.dashboard !== 'undefined') {
                    app.dashboard.load();
                }
                break;

            case 'schedules':
                // Load schedule data if not already loaded
                if (!window.schedulesLoaded) {
                    app.schedules.init();
                    window.schedulesLoaded = true;
                }
                break;

            case 'configuration':
                if (typeof app.configuration !== 'undefined') {
                    app.configuration.load();
                }
                break;

            // SIMULATION sections
            case 'sim-new':
                if (typeof SimulationsModule !== 'undefined') {
                    SimulationsModule.initNewRun();
                }
                break;

            case 'sim-history':
                if (typeof SimulationsModule !== 'undefined') {
                    SimulationsModule.loadRuns();
                }
                break;

            case 'sim-compare':
                if (typeof SimulationsModule !== 'undefined') {
                    SimulationsModule.initCompare();
                }
                break;

            case 'reports':
                console.log('Loading reports...');
                break;
        }
    },
    
    // Get current section
    getCurrentSection() {
        return this.currentSection;
    },
    
    // Check if a section is active
    isSectionActive(sectionName) {
        return this.currentSection === sectionName;
    }
};

// Export for use in other modules
window.navigation = navigation;

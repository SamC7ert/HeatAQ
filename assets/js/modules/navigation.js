/**
 * HeatAQ Navigation Module
 * Section switching and menu management
 */

const Navigation = {
    currentSection: 'day-schedules',

    /**
     * Initialize navigation
     */
    init() {
        // Set up navigation click handlers
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = item.dataset.section;
                this.switchSection(section);
            });
        });

        // Set up tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = btn.dataset.tab;
                this.switchTab(btn.closest('.content-section'), tab);
            });
        });
    },

    /**
     * Switch to a different section
     */
    switchSection(sectionName) {
        // Update navigation menu
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        const activeNav = document.querySelector(`[data-section="${sectionName}"]`);
        if (activeNav) {
            activeNav.classList.add('active');
        }

        // Update content sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });

        const activeSection = document.getElementById(`${sectionName}-section`);
        if (activeSection) {
            activeSection.classList.add('active');
        }

        // Update section title
        const titles = {
            'day-schedules': 'Day Schedules',
            'week-schedules': 'Week Schedules',
            'calendar': 'Calendar Rules',
            'test': 'Test Schedule Resolution'
        };

        const titleElement = document.getElementById('section-title');
        if (titleElement) {
            titleElement.textContent = titles[sectionName] || sectionName;
        }

        this.currentSection = sectionName;

        // Load section data if needed
        this.loadSectionData(sectionName);
    },

    /**
     * Switch tabs within a section
     */
    switchTab(section, tabName) {
        // Update tab buttons
        section.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        const activeBtn = section.querySelector(`[data-tab="${tabName}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }

        // Update tab panes
        section.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });

        const activePane = section.querySelector(`#${tabName}-tab`);
        if (activePane) {
            activePane.classList.add('active');
        }
    },

    /**
     * Load data for a section
     */
    loadSectionData(sectionName) {
        switch (sectionName) {
            case 'day-schedules':
                Schedules.loadDaySchedules();
                break;
            case 'week-schedules':
                Schedules.loadWeekSchedules();
                break;
            case 'calendar':
                Calendar.loadCalendarData();
                break;
            case 'test':
                // Test section doesn't load data automatically
                break;
        }
    }
};

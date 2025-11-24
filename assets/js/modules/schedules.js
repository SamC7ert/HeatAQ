// Schedules module - Manages day and week schedules
// REVERTED to match original single-file version exactly

const schedules = {
    currentTemplate: 1,
    daySchedules: [],
    weekSchedules: [],
    selectedDaySchedule: null,
    selectedWeekSchedule: null,
    
    async init() {
        // Load initial template
        await this.loadTemplate();
    },
    
    async loadTemplate() {
        const selector = document.getElementById('schedule-template-selector');
        this.currentTemplate = selector.value;
        
        // Update description
        const description = document.getElementById('template-description');
        description.textContent = config.templateDescriptions[this.currentTemplate];
        
        // Load data for active tab
        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab) {
            const tabId = activeTab.id;
            if (tabId === 'day-tab') {
                await this.loadDaySchedules();
            } else if (tabId === 'week-tab') {
                await this.loadWeekSchedules();
            } else if (tabId === 'calendar-tab') {
                await app.calendar.loadCalendarData(this.currentTemplate);
            }
        }
    },
    
    async loadDaySchedules() {
        try {
            const data = await api.daySchedules.getAll();
            this.daySchedules = data.schedules || [];
            this.renderDayScheduleSelector();
        } catch (error) {
            console.error('Failed to load day schedules:', error);
        }
    },
    
    renderDayScheduleSelector() {
        const container = document.getElementById('day-schedules-container');
        
        // Create the original structure with dropdown selector
        let html = `
            <div class="card">
                <h3>Day Schedule Configuration</h3>
                <div class="form-group">
                    <label class="form-label">Select Day Schedule:</label>
                    <select id="day-schedule-selector" class="form-control" onchange="app.schedules.loadDaySchedule()">
                        <option value="">-- Select a schedule --</option>
        `;
        
        // Add options for each schedule
        this.daySchedules.forEach(schedule => {
            html += `<option value="${schedule.day_schedule_id}">${schedule.name}</option>`;
        });
        
        html += `
                    </select>
                </div>
                
                <div id="day-schedule-editor" style="display: none;">
                    <h4>Schedule Periods</h4>
                    <div id="periods-container"></div>
                    <button class="btn btn-primary btn-sm" onclick="app.schedules.addPeriod()">+ Add Period</button>
                    <button class="btn btn-success btn-sm" onclick="app.schedules.saveDaySchedule()">Save Schedule</button>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    },
    
    loadDaySchedule() {
        const selector = document.getElementById('day-schedule-selector');
        const scheduleId = parseInt(selector.value);
        
        if (!scheduleId) {
            document.getElementById('day-schedule-editor').style.display = 'none';
            return;
        }
        
        // Find the selected schedule
        const schedule = this.daySchedules.find(s => s.day_schedule_id === scheduleId);
        if (!schedule) return;
        
        this.selectedDaySchedule = schedule;
        
        // Show editor
        document.getElementById('day-schedule-editor').style.display = 'block';
        
        // Parse periods if they're a JSON string
        let periods = [];
        if (schedule.periods) {
            if (typeof schedule.periods === 'string') {
                // Handle GROUP_CONCAT JSON string
                try {
                    let periodStrings = schedule.periods.split('},{');
                    periods = periodStrings.map((p, index) => {
                        if (index === 0 && !p.startsWith('{')) p = '{' + p;
                        if (index === periodStrings.length - 1 && !p.endsWith('}')) p = p + '}';
                        if (!p.startsWith('{')) p = '{' + p;
                        if (!p.endsWith('}')) p = p + '}';
                        return JSON.parse(p);
                    });
                } catch (e) {
                    console.error('Error parsing periods:', e);
                }
            } else if (Array.isArray(schedule.periods)) {
                periods = schedule.periods;
            }
        }
        
        // Render periods
        const container = document.getElementById('periods-container');
        let html = '';
        
        if (schedule.is_closed == 1) {
            html = '<div class="alert alert-info">This is a closed day - pool is not operating</div>';
        } else if (periods.length > 0) {
            html = `
                <table class="table">
                    <thead>
                        <tr>
                            <th>Period</th>
                            <th>Start Time</th>
                            <th>End Time</th>
                            <th>Target Temp (°C)</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            periods.forEach((period, index) => {
                const temp = period.target_temp_c || period.target_temp || '';
                html += `
                    <tr>
                        <td>${period.period_order || index + 1}</td>
                        <td><input type="time" class="form-control form-control-sm" value="${period.start_time}" /></td>
                        <td><input type="time" class="form-control form-control-sm" value="${period.end_time}" /></td>
                        <td><input type="number" class="form-control form-control-sm" value="${temp}" step="0.1" /></td>
                        <td>
                            <button class="btn btn-danger btn-sm" onclick="app.schedules.removePeriod(${index})">Remove</button>
                        </td>
                    </tr>
                `;
            });
            
            html += `
                    </tbody>
                </table>
            `;
        } else {
            html = '<div class="alert alert-warning">No periods defined for this schedule</div>';
        }
        
        container.innerHTML = html;
    },
    
    async loadWeekSchedules() {
        try {
            const data = await api.weekSchedules.getAll();
            this.weekSchedules = data.schedules || [];
            this.renderWeekScheduleSelector();
        } catch (error) {
            console.error('Failed to load week schedules:', error);
        }
    },
    
    renderWeekScheduleSelector() {
        const container = document.getElementById('week-schedules-container');
        
        let html = `
            <div class="card">
                <h3>Week Schedule Configuration</h3>
                <div class="form-group">
                    <label class="form-label">Select Week Schedule:</label>
                    <select id="week-schedule-selector" class="form-control" onchange="app.schedules.loadWeekSchedule()">
                        <option value="">-- Select a schedule --</option>
        `;
        
        this.weekSchedules.forEach(schedule => {
            html += `<option value="${schedule.week_schedule_id}">${schedule.name}</option>`;
        });
        
        html += `
                    </select>
                </div>
                
                <table class="table" id="week-schedule-table" style="display: none;">
                    <thead>
                        <tr>
                            <th>Day</th>
                            <th>Schedule</th>
                            <th>Hours</th>
                        </tr>
                    </thead>
                    <tbody id="week-schedule-tbody">
                        <!-- Will be populated -->
                    </tbody>
                </table>
            </div>
        `;
        
        container.innerHTML = html;
    },
    
    loadWeekSchedule() {
        const selector = document.getElementById('week-schedule-selector');
        const scheduleId = parseInt(selector.value);
        
        if (!scheduleId) {
            document.getElementById('week-schedule-table').style.display = 'none';
            return;
        }
        
        // Find the selected schedule
        const schedule = this.weekSchedules.find(s => s.week_schedule_id === scheduleId);
        if (!schedule) return;
        
        this.selectedWeekSchedule = schedule;
        
        // Show table
        document.getElementById('week-schedule-table').style.display = 'table';
        
        // Populate table
        const tbody = document.getElementById('week-schedule-tbody');
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        
        let html = '';
        dayKeys.forEach((dayKey, index) => {
            const scheduleName = schedule[dayKey + '_schedule_name'] || 'Not set';
            const scheduleId = schedule[dayKey + '_schedule_id'];
            
            // Find the day schedule to get hours
            let hours = '--';
            if (scheduleId) {
                const daySchedule = this.daySchedules.find(s => s.day_schedule_id === scheduleId);
                if (daySchedule && daySchedule.is_closed != 1) {
                    hours = '10:00 - 20:00'; // Default, should parse from periods
                } else if (daySchedule && daySchedule.is_closed == 1) {
                    hours = 'Closed';
                }
            }
            
            html += `
                <tr>
                    <td><strong>${days[index]}</strong></td>
                    <td>
                        <select class="form-control form-control-sm">
                            <option>${scheduleName}</option>
                            ${this.daySchedules.map(ds => 
                                `<option value="${ds.day_schedule_id}">${ds.name}</option>`
                            ).join('')}
                        </select>
                    </td>
                    <td>${hours}</td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html;
    },
    
    // Action methods
    addPeriod() {
        console.log('Add period');
        api.utils.showError('Add period functionality not yet implemented');
    },
    
    removePeriod(index) {
        console.log('Remove period:', index);
        api.utils.showError('Remove period functionality not yet implemented');
    },
    
    saveDaySchedule() {
        console.log('Save day schedule');
        api.utils.showError('Save functionality not yet implemented');
    },
    
    createTemplate() {
        console.log('Create new template');
        api.utils.showError('Template creation not yet implemented');
    },
    
    editTemplate() {
        console.log('Edit template:', this.currentTemplate);
        api.utils.showError('Template editing not yet implemented');
    }
};

// Export for use in other modules
window.schedules = schedules;

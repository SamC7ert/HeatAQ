// API module - Handles all server communication

const api = {
    // Generic API call function
    async call(action, params = {}) {
        try {
            // Build URL as string (no URL objects for compatibility)
            let urlString = config.API_BASE_URL + '?action=' + action;
            
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined && value !== null) {
                    urlString += '&' + key + '=' + encodeURIComponent(value);
                }
            }
            
            const response = await fetch(urlString);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                console.error('API Error:', data.error);
                throw new Error(data.error);
            }
            
            return data;
        } catch (error) {
            console.error(`API call failed for ${action}:`, error);
            throw error;
        }
    },
    
    // POST request for saving data
    async post(action, data) {
        try {
            const response = await fetch(config.API_BASE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: action,
                    ...data
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.error) {
                console.error('API Error:', result.error);
                throw new Error(result.error);
            }
            
            return result;
        } catch (error) {
            console.error(`API POST failed for ${action}:`, error);
            throw error;
        }
    },
    
    // Schedule Templates
    templates: {
        async getAll() {
            return api.call('get_templates');
        },
        
        async getById(templateId) {
            return api.call('get_template', { template_id: templateId });
        },
        
        async create(data) {
            return api.post('create_template', data);
        },
        
        async update(templateId, data) {
            return api.post('update_template', { template_id: templateId, ...data });
        }
    },
    
    // Day Schedules
    daySchedules: {
        async getAll() {
            return api.call('get_day_schedules');
        },
        
        async getById(scheduleId) {
            return api.call('get_day_schedule', { schedule_id: scheduleId });
        },
        
        async create(data) {
            return api.post('create_day_schedule', data);
        },
        
        async update(scheduleId, data) {
            return api.post('update_day_schedule', { schedule_id: scheduleId, ...data });
        },
        
        async delete(scheduleId) {
            return api.post('delete_day_schedule', { schedule_id: scheduleId });
        }
    },
    
    // Week Schedules
    weekSchedules: {
        async getAll() {
            return api.call('get_week_schedules');
        },
        
        async getById(scheduleId) {
            return api.call('get_week_schedule', { schedule_id: scheduleId });
        },
        
        async create(data) {
            return api.post('create_week_schedule', data);
        },
        
        async update(scheduleId, data) {
            return api.post('update_week_schedule', { schedule_id: scheduleId, ...data });
        },
        
        async delete(scheduleId) {
            return api.post('delete_week_schedule', { schedule_id: scheduleId });
        }
    },
    
    // Calendar
    calendar: {
        async getRules(templateId) {
            return api.call('get_calendar_rules', { template_id: templateId });
        },
        
        async getExceptionDays(templateId) {
            return api.call('get_exception_days', { template_id: templateId });
        },
        
        async getReferenceDays() {
            return api.call('get_reference_days');
        },
        
        async createRule(data) {
            return api.post('create_calendar_rule', data);
        },
        
        async updateRule(ruleId, data) {
            return api.post('update_calendar_rule', { rule_id: ruleId, ...data });
        },
        
        async deleteRule(ruleId) {
            return api.post('delete_calendar_rule', { rule_id: ruleId });
        },
        
        async createExceptionDay(data) {
            return api.post('create_exception_day', data);
        },
        
        async updateExceptionDay(dayId, data) {
            return api.post('update_exception_day', { day_id: dayId, ...data });
        },
        
        async deleteExceptionDay(dayId) {
            return api.post('delete_exception_day', { day_id: dayId });
        },
        
        async testResolution(date, templateId) {
            return api.call('resolve_schedule', { date: date, template_id: templateId });
        }
    },
    
    // Utility functions
    utils: {
        // Show error message to user
        showError(message) {
            // TODO: Implement proper error notification
            console.error('Error:', message);
            alert('Error: ' + message);
        },
        
        // Show success message
        showSuccess(message) {
            // TODO: Implement proper success notification
            console.log('Success:', message);
        },
        
        // Handle API errors consistently
        handleError(error) {
            const message = error.message || 'An unexpected error occurred';
            this.showError(message);
        }
    }
};

// Make API module globally available
window.api = api;

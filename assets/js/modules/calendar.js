// Calendar module - Manages calendar rules and holidays
// REVERTED to match original single-file version exactly

const calendar = {
    calendarRules: [],
    exceptionDays: [],
    referenceDays: [],
    dateRanges: [],
    
    async loadCalendarData(templateId) {
        // Load all calendar data
        await this.loadCalendarRules(templateId);
        await this.loadReferenceDays();
    },
    
    async loadCalendarRules(templateId) {
        try {
            const data = await api.calendar.getRules(templateId);
            this.dateRanges = data.rules || [];
            
            // Also load exception days
            const exceptionsData = await api.calendar.getExceptionDays(templateId);
            this.exceptionDays = exceptionsData.exceptions || [];
            
            this.renderCalendarTab();
        } catch (error) {
            console.error('Failed to load calendar rules:', error);
        }
    },
    
    renderCalendarTab() {
        const container = document.getElementById('calendar-tab');
        
        let html = `
            <div class="card">
                <h3>Calendar Configuration</h3>
                
                <!-- Base Schedule -->
                <div class="mb-4">
                    <h5 class="text-primary">Base Schedule</h5>
                    <p class="text-muted text-small">Default schedule applied when no exceptions match</p>
                    <select class="form-control" id="base-week-schedule">
                        <option>Normal Week</option>
                    </select>
                </div>
                
                <!-- Date Ranges -->
                <div class="mb-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="text-primary">Date Ranges</h5>
                        <button onclick="app.calendar.addDateRange()" class="btn btn-primary btn-sm">+ Add Date Range</button>
                    </div>
                    <div class="table-responsive">
                        <table class="table" id="date-ranges-table">
                            <thead>
                                <tr>
                                    <th width="40">Del</th>
                                    <th>Start Date</th>
                                    <th>End Date</th>
                                    <th>Week Schedule</th>
                                    <th>Description</th>
                                </tr>
                            </thead>
                            <tbody id="date-ranges-tbody">
        `;
        
        // Render date ranges
        this.dateRanges.forEach(range => {
            if (range.priority > 0) {
                html += `
                    <tr>
                        <td><button class="btn btn-danger btn-sm" onclick="app.calendar.deleteRange(${range.range_id || range.id})">×</button></td>
                        <td><input type="date" value="${range.start_date}" class="form-control form-control-sm"></td>
                        <td><input type="date" value="${range.end_date}" class="form-control form-control-sm"></td>
                        <td>${range.week_schedule_name || 'Normal Week'}</td>
                        <td><input type="text" value="${range.name || ''}" class="form-control form-control-sm"></td>
                    </tr>
                `;
            }
        });
        
        html += `
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <!-- Exception Days -->
                <div class="mb-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="text-primary">Exception Days (Holidays)</h5>
                        <button onclick="app.calendar.addExceptionDay()" class="btn btn-primary btn-sm">+ Add Exception Day</button>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-striped" id="exception-days-table" style="table-layout: fixed; max-width: 900px;">
                            <thead>
                                <tr>
                                    <th width="80">Type</th>
                                    <th width="160">Name</th>
                                    <th width="100">Date/Ref</th>
                                    <th width="80">Offset</th>
                                    <th width="140">Day Schedule</th>
                                    <th width="50">Del</th>
                                </tr>
                            </thead>
                            <tbody id="exception-days-tbody">
        `;
        
        // Sort exception days - moving first, then fixed
        const sortedExceptions = [...this.exceptionDays].sort((a, b) => {
            if (a.is_moving != b.is_moving) {
                return b.is_moving - a.is_moving; // Moving first
            }
            if (a.is_moving) {
                return (a.easter_offset_days || 0) - (b.easter_offset_days || 0);
            }
            // For fixed, sort by month/day
            return ((a.fixed_month || 0) * 100 + (a.fixed_day || 0)) - 
                   ((b.fixed_month || 0) * 100 + (b.fixed_day || 0));
        });
        
        sortedExceptions.forEach(exception => {
            const type = exception.is_moving ? 'Moving' : 'Fixed';
            const typeClass = exception.is_moving ? 'badge-warning' : 'badge-info';
            const dateRef = exception.is_moving ? 'Easter' : `${exception.fixed_day || ''}/${exception.fixed_month || ''}`;
            const offset = exception.is_moving ? (exception.easter_offset_days >= 0 ? '+' + exception.easter_offset_days : exception.easter_offset_days) : '';
            const daySchedule = exception.day_schedule_name || 'Pool Closed';
            
            html += `
                <tr>
                    <td><span class="badge ${typeClass}">${type}</span></td>
                    <td>${exception.name}</td>
                    <td>${dateRef}</td>
                    <td>${offset}</td>
                    <td>${daySchedule}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="app.calendar.deleteException(${exception.exception_id || exception.id})">×</button></td>
                </tr>
            `;
        });
        
        html += `
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <!-- Test Resolution -->
                <div class="mb-4">
                    <h5 class="text-primary">Test Schedule Resolution</h5>
                    <div class="row">
                        <div class="col-md-6">
                            <input type="date" id="test-date" class="form-control" value="2024-12-24">
                        </div>
                        <div class="col-md-6">
                            <button onclick="app.calendar.testDate()" class="btn btn-primary">Test Date</button>
                        </div>
                    </div>
                    
                    <div id="test-result" class="alert alert-info mt-3" style="display: none;">
                        <h5>Result for <span id="tested-date"></span>:</h5>
                        <p class="mb-1">Applied Rule: <strong id="result-rule"></strong></p>
                        <p class="mb-0">Day Schedule: <strong id="result-day"></strong></p>
                    </div>
                </div>
            </div>
            
            <!-- Reference Days Section -->
            <div class="reference-days-section">
                <h4>📅 Reference Days</h4>
                <p class="text-small">Moving holidays are calculated relative to these reference dates</p>
                <div id="reference-days-container">
                    <!-- Table will be inserted here -->
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    },
    
    async loadReferenceDays() {
        try {
            const data = await api.calendar.getReferenceDays();
            this.referenceDays = data.reference_days || [];
            this.renderReferenceDays();
        } catch (error) {
            console.error('Failed to load reference days:', error);
        }
    },
    
    renderReferenceDays() {
        const container = document.getElementById('reference-days-container');
        if (!container) return;
        
        const currentYear = new Date().getFullYear();
        
        let html = `
            <table class="table" style="background: white;">
                <thead>
                    <tr style="background: #e3f2fd;">
                        <th>Reference Day</th>
                        <th>${currentYear - 1}</th>
                        <th>${currentYear}</th>
                        <th>${currentYear + 1}</th>
                        <th>Used By</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>Easter Sunday</strong></td>
        `;
        
        // Find Easter dates for the three years
        for (let y = currentYear - 1; y <= currentYear + 1; y++) {
            const ref = this.referenceDays.find(r => r.year === y);
            if (ref) {
                const date = new Date(ref.reference_date);
                const formatted = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                html += `<td>${formatted}</td>`;
            } else {
                html += `<td>--</td>`;
            }
        }
        
        html += `
                        <td>All Norwegian moving holidays</td>
                    </tr>
                </tbody>
            </table>
        `;
        
        container.innerHTML = html;
    },
    
    async testDate() {
        const dateInput = document.getElementById('test-date');
        const resultDiv = document.getElementById('test-result');
        
        if (!dateInput.value) {
            api.utils.showError('Please select a date');
            return;
        }
        
        try {
            const result = await api.calendar.testResolution(dateInput.value, schedules.currentTemplate);
            
            resultDiv.style.display = 'block';
            document.getElementById('tested-date').textContent = dateInput.value;
            document.getElementById('result-rule').textContent = result.rule_name || 'Default';
            document.getElementById('result-day').textContent = result.day_schedule || 'Not found';
        } catch (error) {
            resultDiv.style.display = 'block';
            document.getElementById('tested-date').textContent = dateInput.value;
            document.getElementById('result-rule').textContent = 'Error';
            document.getElementById('result-day').textContent = error.message;
        }
    },
    
    // Action methods
    addDateRange() {
        console.log('Add date range');
        api.utils.showError('Add date range functionality not yet implemented');
    },
    
    deleteRange(rangeId) {
        console.log('Delete range:', rangeId);
        api.utils.showError('Delete functionality not yet implemented');
    },
    
    addExceptionDay() {
        console.log('Add exception day');
        api.utils.showError('Add exception day functionality not yet implemented');
    },
    
    deleteException(exceptionId) {
        console.log('Delete exception:', exceptionId);
        api.utils.showError('Delete functionality not yet implemented');
    }
};

// Export for use in other modules
window.calendar = calendar;

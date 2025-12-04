/**
 * Energy Analysis Module
 * Runs multi-scenario capacity analysis with payback calculations
 */

const EnergyAnalysis = {
    // State
    isRunning: false,
    results: [],
    startTime: null,
    investmentCosts: null,

    // localStorage key for state persistence
    STORAGE_KEY: 'heataq_energy_analysis_state',

    /**
     * Save current state to localStorage
     */
    saveState: function() {
        const state = {
            mode: document.getElementById('analysis-mode-hp')?.checked ? 'hp' : 'total',
            // Total Capacity inputs
            totalStart: document.getElementById('ea-total-start')?.value,
            totalStep: document.getElementById('ea-total-step')?.value,
            fixedHp: document.getElementById('ea-fixed-hp')?.value,
            totalCases: document.getElementById('ea-total-cases')?.value,
            // HP Capacity inputs
            hpStart: document.getElementById('ea-hp-start')?.value,
            hpStep: document.getElementById('ea-hp-step')?.value,
            fixedTotal: document.getElementById('ea-fixed-total')?.value,
            hpCases: document.getElementById('ea-hp-cases')?.value,
            // Common settings
            strategy: document.getElementById('ea-strategy')?.value,
            startDate: document.getElementById('ea-start-date')?.value,
            endDate: document.getElementById('ea-end-date')?.value,
            storeHourly: document.getElementById('ea-store-hourly')?.checked,
            // Selections (saved after dropdowns load)
            site: document.getElementById('ea-site-select')?.value,
            pool: document.getElementById('ea-pool-select')?.value,
            config: document.getElementById('ea-config-select')?.value,
            schedule: document.getElementById('ea-schedule')?.value
        };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    },

    /**
     * Restore state from localStorage
     */
    restoreState: function() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (!saved) return null;
            return JSON.parse(saved);
        } catch (e) {
            console.warn('[EnergyAnalysis] Failed to restore state:', e);
            return null;
        }
    },

    /**
     * Apply saved state to form elements
     */
    applyState: function(state) {
        if (!state) return;

        // Mode
        if (state.mode === 'hp') {
            const hpRadio = document.getElementById('analysis-mode-hp');
            if (hpRadio) hpRadio.checked = true;
        }

        // Total Capacity inputs
        if (state.totalStart) document.getElementById('ea-total-start').value = state.totalStart;
        if (state.totalStep) document.getElementById('ea-total-step').value = state.totalStep;
        if (state.fixedHp) document.getElementById('ea-fixed-hp').value = state.fixedHp;
        if (state.totalCases) document.getElementById('ea-total-cases').value = state.totalCases;

        // HP Capacity inputs
        if (state.hpStart) document.getElementById('ea-hp-start').value = state.hpStart;
        if (state.hpStep) document.getElementById('ea-hp-step').value = state.hpStep;
        if (state.fixedTotal) document.getElementById('ea-fixed-total').value = state.fixedTotal;
        if (state.hpCases) document.getElementById('ea-hp-cases').value = state.hpCases;

        // Common settings
        if (state.strategy) document.getElementById('ea-strategy').value = state.strategy;
        if (state.startDate) document.getElementById('ea-start-date').value = state.startDate;
        if (state.endDate) document.getElementById('ea-end-date').value = state.endDate;
        if (state.storeHourly !== undefined) document.getElementById('ea-store-hourly').checked = state.storeHourly;
    },

    /**
     * Initialize the module
     */
    init: function() {
        // Restore saved state
        const savedState = this.restoreState();
        if (savedState) {
            this.applyState(savedState);
        }

        // Add event listeners for input changes to update preview and save state
        const inputs = [
            'ea-fixed-hp', 'ea-total-start', 'ea-total-step', 'ea-total-cases',
            'ea-fixed-total', 'ea-hp-start', 'ea-hp-step', 'ea-hp-cases',
            'ea-strategy', 'ea-start-date', 'ea-end-date'
        ];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => { this.updatePreview(); this.saveState(); });
                el.addEventListener('change', () => { this.updatePreview(); this.saveState(); });
            }
        });

        // Save state on checkbox change
        const storeHourly = document.getElementById('ea-store-hourly');
        if (storeHourly) {
            storeHourly.addEventListener('change', () => this.saveState());
        }

        // Load dropdowns (loadSites will also load investment costs after setting cookie)
        this.loadSites(savedState);
        this.loadConfigs(savedState);
        this.loadSchedules(savedState);

        // Initial preview
        this.updatePreview();

        // Style the selected mode
        this.onModeChange();

        console.log('[EnergyAnalysis] Module initialized');
    },

    /**
     * Load sites into dropdown
     */
    loadSites: async function(savedState) {
        try {
            const response = await fetch('./api/heataq_api.php?action=get_sites');
            const data = await response.json();

            const select = document.getElementById('ea-site-select');
            if (!select) return;

            if (data.sites && data.sites.length > 0) {
                this.sites = data.sites;
                select.innerHTML = data.sites.map(s =>
                    `<option value="${s.id}">${s.name}</option>`
                ).join('');

                // Restore saved value if exists
                if (savedState?.site && data.sites.some(s => s.id == savedState.site)) {
                    select.value = savedState.site;
                }
                // Set cookie for backend API
                if (select.value) {
                    document.cookie = `heataq_pool_site_id=${select.value}; path=/; max-age=31536000`;
                    // Load investment costs with site ID
                    this.loadInvestmentCosts(select.value);
                }
                this.loadPools(select.value, savedState);

                // Save state on change
                select.addEventListener('change', () => this.saveState());
            } else {
                select.innerHTML = '<option value="">No sites found</option>';
            }
        } catch (error) {
            console.error('[EnergyAnalysis] Failed to load sites:', error);
            document.getElementById('ea-site-select').innerHTML = '<option value="">Error loading sites</option>';
        }
    },

    /**
     * Handle site selection change
     */
    onSiteChange: function() {
        const siteId = document.getElementById('ea-site-select')?.value;
        console.log('[EnergyAnalysis] Site changed:', siteId);
        // Set cookie for backend API
        if (siteId) {
            document.cookie = `heataq_pool_site_id=${siteId}; path=/; max-age=31536000`;
            // Reload investment costs for new site
            this.loadInvestmentCosts(siteId);
        }
        this.loadPools(siteId);
    },

    /**
     * Load pools into dropdown
     */
    loadPools: async function(siteId, savedState) {
        const select = document.getElementById('ea-pool-select');
        if (!select) return;

        if (!siteId) {
            select.innerHTML = '<option value="">Select a site first</option>';
            return;
        }

        try {
            const response = await fetch(`./api/heataq_api.php?action=get_pools&pool_site_id=${encodeURIComponent(siteId)}`);
            const data = await response.json();

            if (data.pools && data.pools.length > 0) {
                select.innerHTML = data.pools.map(p =>
                    `<option value="${p.pool_id}">${p.name}</option>`
                ).join('');

                // Restore saved value if exists
                if (savedState?.pool && data.pools.some(p => p.pool_id == savedState.pool)) {
                    select.value = savedState.pool;
                }

                // Save state on change (add once)
                if (!select.dataset.listenerAdded) {
                    select.addEventListener('change', () => this.saveState());
                    select.dataset.listenerAdded = 'true';
                }
            } else {
                select.innerHTML = '<option value="">No pools found</option>';
            }
        } catch (error) {
            console.error('[EnergyAnalysis] Failed to load pools:', error);
            select.innerHTML = '<option value="">Error loading pools</option>';
        }
    },

    /**
     * Load configurations into dropdown
     */
    loadConfigs: async function(savedState) {
        const select = document.getElementById('ea-config-select');
        if (!select) return;

        try {
            const response = await fetch('./api/heataq_api.php?action=get_project_configs');
            const data = await response.json();

            if (data.configs && data.configs.length > 0) {
                select.innerHTML = data.configs.map(c =>
                    `<option value="${c.template_id}">${c.name}</option>`
                ).join('');

                // Restore saved value if exists
                if (savedState?.config && data.configs.some(c => c.template_id == savedState.config)) {
                    select.value = savedState.config;
                }

                // Save state on change
                select.addEventListener('change', () => this.saveState());
            } else {
                console.warn('[EnergyAnalysis] No configs in response');
                select.innerHTML = '<option value="">No configs found</option>';
            }
        } catch (error) {
            console.error('[EnergyAnalysis] Failed to load configs:', error);
            select.innerHTML = '<option value="">Error loading configs</option>';
        }
    },

    /**
     * Handle pool selection change
     */
    onPoolChange: function() {
        // Could update related UI if needed
        console.log('[EnergyAnalysis] Pool changed:', document.getElementById('ea-pool-select')?.value);
    },

    /**
     * Load schedule templates into dropdown
     */
    loadSchedules: async function(savedState) {
        const select = document.getElementById('ea-schedule');
        if (!select) return;

        try {
            const response = await fetch('./api/heataq_api.php?action=get_templates');
            const data = await response.json();

            if (data.templates && data.templates.length > 0) {
                select.innerHTML = data.templates.map(t =>
                    `<option value="${t.template_id}">${t.name}</option>`
                ).join('');

                // Restore saved value if exists
                if (savedState?.schedule && data.templates.some(t => t.template_id == savedState.schedule)) {
                    select.value = savedState.schedule;
                }

                // Save state on change
                select.addEventListener('change', () => this.saveState());
            } else {
                select.innerHTML = '<option value="">No schedules found</option>';
            }
        } catch (error) {
            console.error('[EnergyAnalysis] Failed to load schedules:', error);
        }
    },

    /**
     * Handle mode change (Total Capacity vs HP Distribution)
     */
    onModeChange: function() {
        const isTotalMode = document.getElementById('analysis-mode-total')?.checked;

        // Toggle input visibility
        const totalInputs = document.getElementById('mode-total-inputs');
        const hpInputs = document.getElementById('mode-hp-inputs');
        const titleEl = document.getElementById('mode-inputs-title');
        const inputBox = titleEl?.parentElement;

        if (totalInputs) totalInputs.style.display = isTotalMode ? 'block' : 'none';
        if (hpInputs) hpInputs.style.display = isTotalMode ? 'none' : 'block';
        if (titleEl) {
            titleEl.textContent = isTotalMode ? 'Total Capacity Mode' : 'HP Capacity Mode';
            titleEl.style.color = isTotalMode ? '#1565c0' : '#2e7d32';
        }
        // Change input box background color based on mode
        if (inputBox) {
            inputBox.style.background = isTotalMode ? '#e3f2fd' : '#e8f5e9';
        }

        // Style selected mode labels
        const totalLabel = document.getElementById('mode-total-label');
        const hpLabel = document.getElementById('mode-hp-label');

        if (totalLabel) {
            totalLabel.style.border = isTotalMode ? '2px solid #1976d2' : '2px solid transparent';
            totalLabel.style.background = isTotalMode ? '#e3f2fd' : 'transparent';
        }
        if (hpLabel) {
            hpLabel.style.border = !isTotalMode ? '2px solid #388e3c' : '2px solid transparent';
            hpLabel.style.background = !isTotalMode ? '#e8f5e9' : 'transparent';
        }

        this.updatePreview();
        this.saveState();
    },

    /**
     * Get scenarios based on current mode and inputs
     */
    getScenarios: function() {
        const isTotalMode = document.getElementById('analysis-mode-total')?.checked;
        const scenarios = [];

        if (isTotalMode) {
            const fixedHp = parseFloat(document.getElementById('ea-fixed-hp')?.value) || 175;
            const totalStart = parseFloat(document.getElementById('ea-total-start')?.value) || 250;
            const totalStep = parseFloat(document.getElementById('ea-total-step')?.value) || 25;
            const numCases = parseInt(document.getElementById('ea-total-cases')?.value) || 5;

            for (let i = 0; i < numCases; i++) {
                const total = totalStart + (i * totalStep);
                const boiler = total - fixedHp;
                if (boiler >= 0) {
                    scenarios.push({
                        hp: fixedHp,
                        boiler: boiler,
                        total: total,
                        label: `${fixedHp}+${boiler}`
                    });
                }
            }
        } else {
            const fixedTotal = parseFloat(document.getElementById('ea-fixed-total')?.value) || 325;
            const hpStart = parseFloat(document.getElementById('ea-hp-start')?.value) || 125;
            const hpStep = parseFloat(document.getElementById('ea-hp-step')?.value) || 25;
            const numCases = parseInt(document.getElementById('ea-hp-cases')?.value) || 5;

            for (let i = 0; i < numCases; i++) {
                const hp = hpStart + (i * hpStep);
                const boiler = fixedTotal - hp;
                if (boiler >= 0 && hp <= fixedTotal) {
                    scenarios.push({
                        hp: hp,
                        boiler: boiler,
                        total: fixedTotal,
                        label: `${hp}+${boiler}`
                    });
                }
            }
        }

        return scenarios;
    },

    /**
     * Update the preview text
     */
    updatePreview: function() {
        const scenarios = this.getScenarios();
        const previewEl = document.getElementById('ea-preview');
        if (previewEl) {
            previewEl.textContent = scenarios.map(s => s.label).join(', ') || 'Invalid configuration';
        }
    },

    /**
     * Run the analysis
     */
    run: async function() {
        if (this.isRunning) return;

        const scenarios = this.getScenarios();
        if (scenarios.length === 0) {
            alert('Invalid configuration - no valid scenarios');
            return;
        }

        // Get selections from Energy Analysis tab
        const poolId = document.getElementById('ea-pool-select')?.value || null;
        const configId = document.getElementById('ea-config-select')?.value || null;
        const scheduleId = document.getElementById('ea-schedule')?.value || null;

        // Validate required selections
        if (!poolId) {
            alert('Please select a Pool');
            return;
        }
        if (!configId) {
            alert('Please select a Configuration');
            return;
        }

        this.isRunning = true;
        this.results = [];
        this.startTime = Date.now();

        // Get other settings
        const strategy = document.getElementById('ea-strategy')?.value || 'predictive';
        const startDate = document.getElementById('ea-start-date')?.value || '2024-01-01';
        const endDate = document.getElementById('ea-end-date')?.value || '2024-12-31';
        const storeHourly = document.getElementById('ea-store-hourly')?.checked || false;

        // Load investment costs from current site
        await this.loadInvestmentCosts();

        // UI updates
        const runBtn = document.getElementById('ea-run-btn');
        const progressDiv = document.getElementById('ea-progress');
        const statusEl = document.getElementById('ea-status');

        if (runBtn) runBtn.disabled = true;
        if (progressDiv) progressDiv.style.display = 'block';
        if (statusEl) statusEl.textContent = '';

        this.updateProgress(0, scenarios.length, 'Starting...');

        // Run scenarios sequentially (parallel would overload server)
        for (let i = 0; i < scenarios.length; i++) {
            const scenario = scenarios[i];
            this.updateProgress(i, scenarios.length, `Running case ${i + 1}/${scenarios.length}: ${scenario.label}`);

            try {
                const result = await this.runSingleScenario({
                    hp_capacity: scenario.hp,
                    boiler_capacity: scenario.boiler,
                    strategy: strategy,
                    schedule_id: scheduleId,
                    config_id: configId,
                    start_date: startDate,
                    end_date: endDate,
                    pool_id: poolId,
                    store_hourly: storeHourly,
                    scenario_name: `Energy Analysis: ${scenario.label}`
                });

                this.results.push({
                    ...scenario,
                    summary: result.summary,
                    success: true
                });
            } catch (error) {
                console.error(`[EnergyAnalysis] Case ${i + 1} failed:`, error);
                this.results.push({
                    ...scenario,
                    error: error.message,
                    success: false
                });
            }
        }

        // Complete
        this.updateProgress(scenarios.length, scenarios.length, 'Complete!');

        // Render results
        this.renderResults();

        // Reset UI
        this.isRunning = false;
        if (runBtn) runBtn.disabled = false;
        setTimeout(() => {
            if (progressDiv) progressDiv.style.display = 'none';
        }, 2000);
    },

    /**
     * Run a single simulation scenario
     */
    runSingleScenario: async function(params) {
        const response = await fetch('./api/simulation_api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'run_simulation',
                scenario_name: params.scenario_name,
                start_date: params.start_date,
                end_date: params.end_date,
                pool_id: params.pool_id,
                config_id: params.config_id,
                template_id: params.schedule_id,
                store_hourly: params.store_hourly,
                config_override: {
                    equipment: {
                        hp_capacity_kw: params.hp_capacity,
                        boiler_capacity_kw: params.boiler_capacity
                    },
                    control: {
                        strategy: params.strategy
                    }
                }
            })
        });

        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        return data;
    },

    /**
     * Update progress display
     */
    updateProgress: function(completed, total, text) {
        const progressBar = document.getElementById('ea-progress-bar');
        const progressText = document.getElementById('ea-progress-text');
        const progressTime = document.getElementById('ea-progress-time');

        const percent = total > 0 ? (completed / total) * 100 : 0;
        if (progressBar) progressBar.style.width = percent + '%';
        if (progressText) progressText.textContent = text;

        // Estimate remaining time
        if (completed > 0 && completed < total) {
            const elapsed = (Date.now() - this.startTime) / 1000;
            const perItem = elapsed / completed;
            const remaining = perItem * (total - completed);
            const mins = Math.floor(remaining / 60);
            const secs = Math.floor(remaining % 60);
            if (progressTime) progressTime.textContent = `~${mins}:${secs.toString().padStart(2, '0')} remaining`;
        } else if (completed >= total) {
            if (progressTime) progressTime.textContent = 'Done!';
        }
    },

    /**
     * Load investment costs from current site
     */
    loadInvestmentCosts: async function(siteId) {
        // Get site ID from parameter, dropdown, or cookie
        if (!siteId) {
            siteId = document.getElementById('ea-site-select')?.value;
        }
        if (!siteId) {
            console.warn('[EnergyAnalysis] No site ID for investment costs');
            this.investmentCosts = null;
            return;
        }

        try {
            const response = await fetch(`./api/heataq_api.php?action=get_project_site&pool_site_id=${siteId}`);
            const data = await response.json();
            console.log('[EnergyAnalysis] get_project_site response:', data);

            if (data.error) {
                console.warn('[EnergyAnalysis] get_project_site returned error:', data.error);
                this.investmentCosts = null;
                return;
            }

            this.investmentCosts = {
                hp_base: parseFloat(data.hp_base_cost_nok) || 0,
                hp_marginal: parseFloat(data.hp_marginal_cost_per_kw) || 0,
                boiler_base: parseFloat(data.boiler_base_cost_nok) || 0,
                boiler_marginal: parseFloat(data.boiler_marginal_cost_per_kw) || 0
            };

            console.log('[EnergyAnalysis] Investment costs loaded:', this.investmentCosts);
        } catch (error) {
            console.error('[EnergyAnalysis] Failed to load investment costs:', error);
            this.investmentCosts = null;
        }
    },

    /**
     * Calculate investment for a scenario
     */
    calcInvestment: function(hp, boiler) {
        if (!this.investmentCosts) return null;
        const { hp_base, hp_marginal, boiler_base, boiler_marginal } = this.investmentCosts;
        if (hp_base === 0 && hp_marginal === 0 && boiler_base === 0 && boiler_marginal === 0) {
            return null; // No investment data configured
        }
        return (hp_base + hp * hp_marginal) + (boiler_base + boiler * boiler_marginal);
    },

    /**
     * Render results table
     */
    renderResults: function() {
        const resultsCard = document.getElementById('ea-results-card');
        const resultsTitle = document.getElementById('ea-results-title');
        const thead = document.getElementById('ea-results-thead');
        const tbody = document.getElementById('ea-results-tbody');

        if (!resultsCard || !thead || !tbody) return;

        const isTotalMode = document.getElementById('analysis-mode-total')?.checked;

        // Build header title based on mode
        let modeDesc;
        if (isTotalMode) {
            const firstTotal = this.results[0]?.total || 0;
            const lastTotal = this.results[this.results.length - 1]?.total || 0;
            modeDesc = `Total Capacity Analysis - ${firstTotal} kW to ${lastTotal} kW`;
        } else {
            const fixedTotal = this.results[0]?.total || 0;
            modeDesc = `Heatpump Capacity Analysis - ${fixedTotal} kW Total`;
        }

        if (resultsTitle) resultsTitle.textContent = modeDesc;

        // Build header with light blue background
        let headerHtml = '<tr style="background: #e3f2fd;"><th style="width: 160px;">Parameter</th><th style="width: 70px;">Unit</th>';
        this.results.forEach((r, i) => {
            headerHtml += `<th style="text-align: right;">Case ${i + 1}</th>`;
        });
        headerHtml += '</tr>';
        thead.innerHTML = headerHtml;

        // Build body rows
        const rows = [];

        // HP + Boiler row
        rows.push(this.buildRow('HP + Boiler', 'kW',
            this.results.map(r => r.label), false, false));

        // Thermal Pool - with thick bottom border to separate from electric section
        rows.push(this.buildRowStyled('Thermal Pool', 'MWh/yr',
            this.results.map(r => r.success ? ((r.summary?.hp_thermal_kwh || 0) + (r.summary?.boiler_thermal_kwh || 0)) / 1000 : '-'),
            true, { borderBottom: '2px solid #999' }));

        // HP Electric (API uses total_hp_energy_kwh)
        rows.push(this.buildRow('HP Electric', 'MWh/yr',
            this.results.map(r => r.success ? (r.summary?.total_hp_energy_kwh || 0) / 1000 : '-'),
            true, false));

        // Boiler Electric (API uses total_boiler_energy_kwh)
        rows.push(this.buildRow('Boiler Electric', 'MWh/yr',
            this.results.map(r => r.success ? (r.summary?.total_boiler_energy_kwh || 0) / 1000 : '-'),
            true, false));

        // Total Electric - all bold including unit
        const totalElec = this.results.map(r => {
            if (!r.success) return null;
            const hp = r.summary?.total_hp_energy_kwh || 0;
            const boiler = r.summary?.total_boiler_energy_kwh || 0;
            return (hp + boiler) / 1000;
        });
        rows.push(this.buildTotalElectricRow('Total Electric', 'MWh/yr', totalElec));

        // HP Share % - italic, indented
        rows.push(this.buildRowStyled('    HP Share', '%',
            this.results.map(r => {
                if (!r.success) return '-';
                const hpThermal = r.summary?.hp_thermal_kwh || 0;
                const boilerThermal = r.summary?.boiler_thermal_kwh || 0;
                const total = hpThermal + boilerThermal;
                return total > 0 ? (hpThermal / total * 100).toFixed(1) + '%' : '-';
            }), false, { fontStyle: 'italic' }));

        // Divider after HP Share
        rows.push(`<tr><td colspan="${2 + this.results.length}" style="background: #e9ecef; height: 2px; padding: 0;"></td></tr>`);

        // Energy Cost
        const energyCosts = this.results.map(r => r.success ? (r.summary?.total_cost || 0) / 1000 : null);
        rows.push(this.buildRow('Energy Cost', 'kNOK/yr', energyCosts, true, false));

        // Energy Cost Diff vs Prev (italic, indented)
        const energyDiffs = this.calcDiffsVsPrev(energyCosts);
        rows.push(this.buildDiffRow('Diff vs prev', 'kNOK/yr', energyDiffs, true));

        // Investment (always show, dashes if no data configured)
        try {
            const investments = this.results.map(r => this.calcInvestment(r.hp || 0, r.boiler || 0));
            console.log('[EnergyAnalysis] Investments:', investments);

            rows.push(this.buildRow('Investment', 'kNOK',
                investments.map(v => v !== null ? v / 1000 : '-'), true, false));

            // Investment Diff vs Prev (italic, indented)
            const invDiffs = this.calcDiffsVsPrev(investments.map(v => v !== null ? v / 1000 : null));
            rows.push(this.buildDiffRow('Diff vs prev', 'kNOK', invDiffs, false));

            // Payback vs Prev - highlight only in HP Capacity mode
            const paybacks = this.calcPaybackVsPrev(investments, energyCosts);
            if (isTotalMode) {
                rows.push(this.buildPaybackRow('Payback vs prev', 'years', paybacks));
            } else {
                rows.push(this.buildPaybackRowStyled('Payback vs prev', 'years', paybacks));
            }
        } catch (err) {
            console.error('[EnergyAnalysis] Error calculating investment rows:', err);
            rows.push('<tr><td colspan="7" style="color: red;">Error calculating investment</td></tr>');
        }

        // Divider
        rows.push(`<tr><td colspan="${2 + this.results.length}" style="background: #e9ecef; height: 2px; padding: 0;"></td></tr>`);

        // Min Temperature
        rows.push(this.buildRow('Min Temperature', '°C',
            this.results.map(r => r.success ? (r.summary?.min_water_temp?.toFixed(2) || '-') : '-'),
            false, false));

        // Days < 27°C - highlight in Total Capacity mode
        if (isTotalMode) {
            rows.push(this.buildRowStyled('Days < 27°C', 'days',
                this.results.map(r => r.success ? (r.summary?.days_below_27 || 0) : '-'),
                false, { background: '#e3f2fd' }));
        } else {
            rows.push(this.buildRow('Days < 27°C', 'days',
                this.results.map(r => r.success ? (r.summary?.days_below_27 || 0) : '-'),
                false, false));
        }

        // Days < 26°C - highlight in Total Capacity mode
        if (isTotalMode) {
            rows.push(this.buildRowStyled('Days < 26°C', 'days',
                this.results.map(r => r.success ? (r.summary?.days_below_26 || 0) : '-'),
                false, { background: '#e3f2fd' }));
        } else {
            rows.push(this.buildRow('Days < 26°C', 'days',
                this.results.map(r => r.success ? (r.summary?.days_below_26 || 0) : '-'),
                false, false));
        }

        tbody.innerHTML = rows.join('');
        resultsCard.style.display = 'block';
    },

    /**
     * Build a standard row
     */
    buildRow: function(label, unit, values, formatNum, isBold) {
        let html = `<tr>`;
        html += `<td${isBold ? ' style="font-weight: bold;"' : ''}>${label}</td>`;
        html += `<td style="color: #666; font-size: 12px;">${unit}</td>`;

        values.forEach(v => {
            let displayVal = v;
            if (typeof v === 'number' && formatNum) {
                displayVal = v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
            }
            html += `<td style="text-align: right;${isBold ? ' font-weight: bold;' : ''}">${displayVal}</td>`;
        });

        html += '</tr>';
        return html;
    },

    /**
     * Build Total Electric row - all bold including unit
     */
    buildTotalElectricRow: function(label, unit, values) {
        let html = `<tr style="font-weight: bold;">`;
        html += `<td>${label}</td>`;
        html += `<td style="font-size: 12px;">${unit}</td>`;

        values.forEach(v => {
            let displayVal = v;
            if (typeof v === 'number') {
                displayVal = v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
            }
            html += `<td style="text-align: right;">${displayVal !== null ? displayVal : '-'}</td>`;
        });

        html += '</tr>';
        return html;
    },

    /**
     * Build a row with custom styles
     */
    buildRowStyled: function(label, unit, values, formatNum, styles) {
        const rowStyle = [];
        if (styles.background) rowStyle.push(`background: ${styles.background}`);
        if (styles.borderBottom) rowStyle.push(`border-bottom: ${styles.borderBottom}`);
        if (styles.fontStyle) rowStyle.push(`font-style: ${styles.fontStyle}`);

        let html = `<tr${rowStyle.length ? ` style="${rowStyle.join('; ')}"` : ''}>`;
        html += `<td>${label}</td>`;
        html += `<td style="color: #666; font-size: 12px;">${unit}</td>`;

        values.forEach(v => {
            let displayVal = v;
            if (typeof v === 'number' && formatNum) {
                displayVal = v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
            }
            html += `<td style="text-align: right;">${displayVal}</td>`;
        });

        html += '</tr>';
        return html;
    },

    /**
     * Build a diff row (italic, indented, all green)
     */
    buildDiffRow: function(label, unit, values, isNegativeGood) {
        let html = `<tr style="font-style: italic; color: #28a745;">`;
        html += `<td style="padding-left: 20px;">↳ ${label}</td>`;
        html += `<td style="font-size: 12px;">${unit}</td>`;

        values.forEach((v, i) => {
            if (i === 0 || v === null) {
                html += `<td style="text-align: right; color: #666;">-</td>`;
            } else {
                const sign = v >= 0 ? '+' : '';
                html += `<td style="text-align: right;">${sign}${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}</td>`;
            }
        });

        html += '</tr>';
        return html;
    },

    /**
     * Build payback row (bold)
     */
    buildPaybackRow: function(label, unit, values) {
        let html = `<tr>`;
        html += `<td style="font-weight: bold;">${label}</td>`;
        html += `<td style="font-size: 12px; color: #666;">${unit}</td>`;

        values.forEach((v, i) => {
            if (i === 0 || v === null || v === Infinity || v < 0) {
                html += `<td style="text-align: right;">-</td>`;
            } else {
                const color = v <= 3 ? '#28a745' : (v <= 7 ? '#ffc107' : '#dc3545');
                html += `<td style="text-align: right; color: ${color};">${v.toFixed(2)}</td>`;
            }
        });

        html += '</tr>';
        return html;
    },

    /**
     * Build payback row with light green background (HP Capacity mode)
     */
    buildPaybackRowStyled: function(label, unit, values) {
        let html = `<tr style="background: #e8f5e9; font-weight: bold;">`;
        html += `<td>${label}</td>`;
        html += `<td style="font-size: 12px;">${unit}</td>`;

        values.forEach((v, i) => {
            if (i === 0 || v === null || v === Infinity || v < 0) {
                html += `<td style="text-align: right;">-</td>`;
            } else {
                html += `<td style="text-align: right;">${v.toFixed(2)}</td>`;
            }
        });

        html += '</tr>';
        return html;
    },

    /**
     * Calculate differences vs previous column
     */
    calcDiffsVsPrev: function(values) {
        return values.map((v, i) => {
            if (i === 0 || v === null || values[i - 1] === null) return null;
            return v - values[i - 1];
        });
    },

    /**
     * Calculate payback years vs previous column
     * Payback = Additional Investment / Annual Energy Savings
     */
    calcPaybackVsPrev: function(investments, energyCosts) {
        return investments.map((inv, i) => {
            if (i === 0) return null;

            const prevInv = investments[i - 1];
            const currCost = energyCosts[i];
            const prevCost = energyCosts[i - 1];

            if (inv === null || prevInv === null || currCost === null || prevCost === null) {
                return null;
            }

            const addedInvestment = (inv - prevInv) / 1000; // Convert to kNOK
            const annualSavings = prevCost - currCost; // kNOK/yr (positive if costs decreased)

            if (annualSavings <= 0) {
                return Infinity; // No savings or costs increased
            }

            return addedInvestment / annualSavings;
        });
    }
};

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Delay initialization to ensure other modules are loaded
    setTimeout(() => {
        EnergyAnalysis.init();
    }, 500);
});

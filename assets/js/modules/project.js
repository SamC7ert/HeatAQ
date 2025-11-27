// Project Management Module

const ProjectModule = {
    currentProject: null,
    projects: [],
    currentSite: null,
    weatherStations: [],

    // Load project data
    async load() {
        try {
            // Load current project from localStorage
            const projectId = localStorage.getItem('heataq_project');
            const projectName = localStorage.getItem('heataq_project_name') || 'Default Project';
            const projectDesc = localStorage.getItem('heataq_project_desc') || '';

            this.currentProject = {
                id: projectId,
                name: projectName,
                description: projectDesc
            };

            // Update display
            this.updateDisplay();

            // Load site data
            await this.loadSiteData();

            // Load project summary
            await this.loadSummary();

            // Load projects list
            await this.loadProjectsList();
        } catch (error) {
            console.error('Error loading project:', error);
        }
    },

    // Load site data from localStorage or API
    async loadSiteData() {
        try {
            // Load from localStorage
            const siteData = localStorage.getItem('heataq_site');
            if (siteData) {
                this.currentSite = JSON.parse(siteData);
            } else {
                // Default site
                this.currentSite = {
                    name: 'Main Site',
                    latitude: null,
                    longitude: null,
                    weather_station_id: null,
                    weather_station_name: null,
                    pools: []
                };
            }

            // Update site display
            this.updateSiteDisplay();

            // Load weather stations
            await this.loadWeatherStations();
        } catch (error) {
            console.error('Error loading site data:', error);
        }
    },

    // Update site card display
    updateSiteDisplay() {
        const site = this.currentSite;
        if (!site) return;

        // Update name
        const nameEl = document.getElementById('site-name');
        if (nameEl) nameEl.textContent = site.name || 'Main Site';

        // Update location
        const locationEl = document.getElementById('site-location');
        if (locationEl) {
            if (site.latitude && site.longitude) {
                locationEl.textContent = this.getLocationName(site.latitude, site.longitude);
            } else {
                locationEl.textContent = 'Location not set';
            }
        }

        // Update coordinates
        const latEl = document.getElementById('site-latitude');
        const lngEl = document.getElementById('site-longitude');
        if (latEl) latEl.textContent = site.latitude ? `${site.latitude.toFixed(4)}°N` : '-';
        if (lngEl) lngEl.textContent = site.longitude ? `${site.longitude.toFixed(4)}°E` : '-';

        // Update weather station
        const wsEl = document.getElementById('site-weather-station');
        if (wsEl) wsEl.textContent = site.weather_station_name || 'Not connected';

        // Update solar estimate
        const solarEl = document.getElementById('site-solar');
        if (solarEl) {
            if (site.latitude) {
                const solar = this.estimateSolar(site.latitude);
                solarEl.textContent = `~${solar} kWh/m²/yr`;
            } else {
                solarEl.textContent = '-';
            }
        }

        // Update map
        this.updateMapPreview('site-map', site.latitude, site.longitude);

        // Update pools list
        this.updatePoolsList();

        // Update dashboard weather station
        const dashWs = document.getElementById('dash-weather-station');
        if (dashWs) dashWs.textContent = site.weather_station_name || '-';
    },

    // Get approximate location name from coordinates
    getLocationName(lat, lng) {
        // Simple approximation for Norway
        if (lat >= 69) return 'Northern Norway';
        if (lat >= 63) return 'Central Norway';
        if (lat >= 60) return 'Western Norway';
        if (lat >= 58) return 'Southern Norway';
        return `${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E`;
    },

    // Estimate annual solar radiation based on latitude
    estimateSolar(latitude) {
        // Rough estimates for Norway latitudes (kWh/m²/year)
        if (latitude >= 70) return 700;
        if (latitude >= 67) return 780;
        if (latitude >= 64) return 850;
        if (latitude >= 62) return 920;
        if (latitude >= 60) return 980;
        if (latitude >= 58) return 1050;
        return 1100;
    },

    // Update map preview
    updateMapPreview(containerId, lat, lng) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (lat && lng) {
            // Use OpenStreetMap embed iframe (more reliable than static image)
            const zoom = 14;
            const bbox = this.calculateBbox(lat, lng, zoom);
            const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
            container.innerHTML = `<iframe src="${embedUrl}" style="width:100%;height:100%;border:none;" loading="lazy"></iframe>`;
        } else {
            container.innerHTML = `<div class="site-map-placeholder"><div>🗺️</div><div>Enter coordinates to show map</div></div>`;
        }
    },

    // Calculate bounding box for map embed
    calculateBbox(lat, lng, zoom) {
        // Approximate bbox calculation for given zoom level
        const latDelta = 0.01 * Math.pow(2, 14 - zoom);
        const lngDelta = 0.015 * Math.pow(2, 14 - zoom);
        const west = lng - lngDelta;
        const south = lat - latDelta;
        const east = lng + lngDelta;
        const north = lat + latDelta;
        return `${west},${south},${east},${north}`;
    },

    // Update pools list in site card
    updatePoolsList() {
        const listEl = document.getElementById('site-pools-list');
        if (!listEl) return;

        // Get pools from configuration if available
        let pools = this.currentSite?.pools || [];

        if (typeof app.configuration !== 'undefined') {
            const config = app.configuration.getConfig();
            if (config?.pool) {
                pools = [{
                    name: 'Main Pool',
                    volume: config.pool.volume,
                    surface_area: config.pool.surface_area
                }];
            }
        }

        if (pools.length > 0) {
            listEl.innerHTML = pools.map(pool =>
                `<li>${pool.name} <span class="pool-volume">${pool.volume || '-'} m³</span></li>`
            ).join('');

            // Update dashboard
            const poolCountEl = document.getElementById('dash-pool-count');
            const totalVolEl = document.getElementById('dash-total-volume');
            if (poolCountEl) poolCountEl.textContent = pools.length;
            if (totalVolEl) {
                const totalVol = pools.reduce((sum, p) => sum + (p.volume || 0), 0);
                totalVolEl.textContent = totalVol > 0 ? `${totalVol} m³` : '-';
            }
        } else {
            listEl.innerHTML = '<li class="text-muted">No pools configured</li>';
        }
    },

    // Load weather stations
    async loadWeatherStations() {
        try {
            const response = await fetch(`${config.API_BASE_URL}?action=get_weather_stations`);
            if (response.ok) {
                const data = await response.json();
                // Handle both array and object with stations property
                this.weatherStations = Array.isArray(data) ? data : (data.stations || []);
                console.log('[Project] Loaded weather stations:', this.weatherStations.length);
            } else {
                console.warn('[Project] Weather stations API returned:', response.status);
                this.weatherStations = [];
            }
        } catch (error) {
            console.error('[Project] Error loading weather stations:', error);
            this.weatherStations = [];
        }
    },

    // Edit site - show modal
    async editSite() {
        const modal = document.getElementById('edit-site-modal');
        if (!modal) return;

        // Ensure weather stations are loaded
        if (this.weatherStations.length === 0) {
            await this.loadWeatherStations();
        }

        const site = this.currentSite || {};
        console.log('[Project] Editing site:', site);

        // Populate form
        const nameEl = document.getElementById('edit-site-name');
        const latEl = document.getElementById('edit-site-lat');
        const lngEl = document.getElementById('edit-site-lng');

        if (nameEl) nameEl.value = site.name || '';
        if (latEl) latEl.value = site.latitude || '';
        if (lngEl) lngEl.value = site.longitude || '';

        // Populate weather station dropdown
        const wsSelect = document.getElementById('edit-site-weather');
        if (wsSelect) {
            wsSelect.innerHTML = '<option value="">-- Select Weather Station --</option>';
            console.log('[Project] Populating weather stations:', this.weatherStations.length);
            this.weatherStations.forEach(ws => {
                const selected = ws.station_id === site.weather_station_id ? 'selected' : '';
                wsSelect.innerHTML += `<option value="${ws.station_id}" ${selected}>${ws.name || ws.station_name} (${ws.station_id})</option>`;
            });
        }

        // Update solar estimate
        this.updateSolarEstimate();

        // Update map preview in modal
        this.updateMapPreview('site-map-preview', site.latitude, site.longitude);

        // Add event listeners for coordinate changes (remove old ones first to avoid duplicates)
        const newLatEl = document.getElementById('edit-site-lat');
        const newLngEl = document.getElementById('edit-site-lng');
        if (newLatEl) {
            newLatEl.onchange = () => this.onCoordinateChange();
            newLatEl.oninput = () => this.onCoordinateChange();
        }
        if (newLngEl) {
            newLngEl.onchange = () => this.onCoordinateChange();
            newLngEl.oninput = () => this.onCoordinateChange();
        }

        modal.style.display = 'flex';
    },

    // Handle coordinate change in edit modal
    onCoordinateChange() {
        const lat = parseFloat(document.getElementById('edit-site-lat').value);
        const lng = parseFloat(document.getElementById('edit-site-lng').value);

        this.updateSolarEstimate();
        this.updateMapPreview('site-map-preview', lat || null, lng || null);
    },

    // Update solar estimate in modal
    updateSolarEstimate() {
        const lat = parseFloat(document.getElementById('edit-site-lat').value);
        const solarEl = document.getElementById('edit-site-solar-estimate');

        if (solarEl) {
            if (lat && lat >= 50 && lat <= 75) {
                solarEl.textContent = `~${this.estimateSolar(lat)} kWh/m²/yr`;
            } else {
                solarEl.textContent = '-';
            }
        }
    },

    // Hide site modal
    hideSiteModal() {
        const modal = document.getElementById('edit-site-modal');
        if (modal) modal.style.display = 'none';
    },

    // Save site
    saveSite() {
        const nameEl = document.getElementById('edit-site-name');
        const latEl = document.getElementById('edit-site-lat');
        const lngEl = document.getElementById('edit-site-lng');
        const wsEl = document.getElementById('edit-site-weather');

        // Debug: log raw values
        console.log('[Project] Save - Raw values:', {
            name: nameEl?.value,
            lat: latEl?.value,
            lng: lngEl?.value,
            ws: wsEl?.value
        });

        const name = nameEl?.value?.trim() || '';
        const latRaw = latEl?.value;
        const lngRaw = lngEl?.value;
        const lat = latRaw ? parseFloat(latRaw) : null;
        const lng = lngRaw ? parseFloat(lngRaw) : null;
        const wsId = wsEl?.value || null;

        // Debug: log parsed values
        console.log('[Project] Save - Parsed values:', { name, lat, lng, wsId });

        // Find weather station name
        let wsName = null;
        if (wsId) {
            const ws = this.weatherStations.find(w => w.station_id === wsId);
            if (ws) wsName = ws.name || ws.station_name;
        }

        // Update site
        this.currentSite = {
            ...this.currentSite,
            name: name || 'Main Site',
            latitude: lat,
            longitude: lng,
            weather_station_id: wsId,
            weather_station_name: wsName
        };

        // Save to localStorage
        localStorage.setItem('heataq_site', JSON.stringify(this.currentSite));

        // Update display
        this.updateSiteDisplay();
        this.hideSiteModal();

        console.log('[Project] Site saved:', this.currentSite);
    },

    // Show add site modal (placeholder)
    showAddSiteModal() {
        alert('Multi-site support coming soon. Currently only one site per project is supported.');
    },

    // Update project name and description display
    updateDisplay() {
        const nameEl = document.getElementById('project-display-name');
        const descEl = document.getElementById('project-display-desc');

        if (nameEl) {
            nameEl.textContent = this.currentProject?.name || 'Unnamed Project';
        }
        if (descEl) {
            descEl.textContent = this.currentProject?.description || 'Click to add description...';
        }

        // Also update header
        const headerProject = document.getElementById('current-project');
        if (headerProject) {
            headerProject.textContent = this.currentProject?.name || 'Project';
        }
    },

    // Load project summary data
    async loadSummary() {
        try {
            // Get configuration data
            if (typeof app.configuration !== 'undefined') {
                const config = app.configuration.getConfig();
                if (config) {
                    const siteEl = document.getElementById('dash-site-name');
                    const areaEl = document.getElementById('dash-pool-area');
                    const hpEl = document.getElementById('dash-hp-capacity');
                    const boilerEl = document.getElementById('dash-boiler-capacity');

                    if (siteEl) siteEl.textContent = this.currentProject?.name || '-';
                    if (areaEl) areaEl.textContent = config.pool?.surface_area ? `${config.pool.surface_area} m²` : '-';
                    if (hpEl) hpEl.textContent = config.equipment?.hp_capacity_kw ? `${config.equipment.hp_capacity_kw} kW` : '-';
                    if (boilerEl) boilerEl.textContent = config.equipment?.boiler_capacity_kw ? `${config.equipment.boiler_capacity_kw} kW` : '-';
                }
            }

            // Get weather data range
            const weatherResponse = await fetch(`${config.API_BASE_URL}?action=getWeatherRange`);
            if (weatherResponse.ok) {
                const weatherData = await weatherResponse.json();
                const rangeEl = document.getElementById('dash-weather-range');
                const countEl = document.getElementById('dash-weather-count');

                if (rangeEl && weatherData.min_date && weatherData.max_date) {
                    rangeEl.textContent = `${weatherData.min_date} to ${weatherData.max_date}`;
                }
                if (countEl && weatherData.count) {
                    countEl.textContent = weatherData.count.toLocaleString();
                }
            }

            // Get recent simulations
            await this.loadRecentSimulations();
        } catch (error) {
            console.error('Error loading project summary:', error);
        }
    },

    // Load recent simulation runs
    async loadRecentSimulations() {
        try {
            const response = await fetch(`${config.API_BASE_URL}?action=getSimulationRuns`);
            if (response.ok) {
                const runs = await response.json();
                const container = document.getElementById('dash-recent-runs');

                if (container && Array.isArray(runs) && runs.length > 0) {
                    // Show last 3 runs
                    const recentRuns = runs.slice(0, 3);
                    container.innerHTML = recentRuns.map(run => {
                        const date = new Date(run.created_at).toLocaleDateString();
                        return `<div style="padding: 5px 0; border-bottom: 1px solid #eee;">
                            <strong>${run.scenario_name || 'Run #' + run.id}</strong>
                            <span style="color: #666; font-size: 12px; margin-left: 10px;">${date}</span>
                        </div>`;
                    }).join('');
                } else if (container) {
                    container.innerHTML = '<span class="text-muted">No simulations yet</span>';
                }
            }
        } catch (error) {
            console.error('Error loading recent simulations:', error);
        }
    },

    // Load list of available projects
    async loadProjectsList() {
        try {
            const response = await fetch(`${config.API_BASE_URL}?action=getProjects`);
            const container = document.getElementById('projects-list');

            if (response.ok) {
                this.projects = await response.json();

                if (container && Array.isArray(this.projects) && this.projects.length > 0) {
                    container.innerHTML = this.projects.map(project => {
                        const isActive = project.id == this.currentProject?.id;
                        return `<div class="project-item" style="padding: 10px; border: 1px solid ${isActive ? '#0d6efd' : '#dee2e6'}; border-radius: 6px; margin-bottom: 8px; background: ${isActive ? '#e7f1ff' : '#fff'}; cursor: pointer;" onclick="app.project.switchProject(${project.id})">
                            <strong>${project.name || 'Unnamed Project'}</strong>
                            ${isActive ? '<span style="float: right; color: #0d6efd; font-size: 12px;">Current</span>' : ''}
                            <p style="margin: 5px 0 0; font-size: 12px; color: #666;">${project.description || 'No description'}</p>
                        </div>`;
                    }).join('');
                } else if (container) {
                    container.innerHTML = `<div class="project-item" style="padding: 10px; border: 1px solid #0d6efd; border-radius: 6px; background: #e7f1ff;">
                        <strong>${this.currentProject?.name || 'Default Project'}</strong>
                        <span style="float: right; color: #0d6efd; font-size: 12px;">Current</span>
                        <p style="margin: 5px 0 0; font-size: 12px; color: #666;">${this.currentProject?.description || 'No description'}</p>
                    </div>`;
                }
            } else if (container) {
                // API might not have getProjects yet - show current project only
                container.innerHTML = `<div class="project-item" style="padding: 10px; border: 1px solid #0d6efd; border-radius: 6px; background: #e7f1ff;">
                    <strong>${this.currentProject?.name || 'Default Project'}</strong>
                    <span style="float: right; color: #0d6efd; font-size: 12px;">Current</span>
                    <p style="margin: 5px 0 0; font-size: 12px; color: #666;">${this.currentProject?.description || 'No description'}</p>
                </div>`;
            }
        } catch (error) {
            console.error('Error loading projects list:', error);
            // Show current project as fallback
            const container = document.getElementById('projects-list');
            if (container) {
                container.innerHTML = `<div class="project-item" style="padding: 10px; border: 1px solid #0d6efd; border-radius: 6px; background: #e7f1ff;">
                    <strong>${this.currentProject?.name || 'Default Project'}</strong>
                    <span style="float: right; color: #0d6efd; font-size: 12px;">Current</span>
                </div>`;
            }
        }
    },

    // Edit project name
    editName() {
        const displayEl = document.getElementById('project-display-name');
        const formEl = document.getElementById('project-edit-name-form');
        const inputEl = document.getElementById('project-name-input');

        if (inputEl) {
            inputEl.value = this.currentProject?.name || '';
        }
        if (formEl) {
            formEl.style.display = 'block';
        }
        if (inputEl) {
            inputEl.focus();
        }
    },

    // Cancel name edit
    cancelEditName() {
        const formEl = document.getElementById('project-edit-name-form');
        if (formEl) {
            formEl.style.display = 'none';
        }
    },

    // Save project name
    async saveName() {
        const inputEl = document.getElementById('project-name-input');
        const newName = inputEl?.value?.trim();

        if (!newName) {
            alert('Please enter a project name');
            return;
        }

        try {
            // Update in backend (if API supports it)
            const response = await fetch(`${config.API_BASE_URL}?action=updateProject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_id: this.currentProject?.id,
                    name: newName
                })
            });

            // Update locally regardless of backend support
            this.currentProject.name = newName;
            localStorage.setItem('heataq_project_name', newName);

            // Update display
            this.updateDisplay();
            this.cancelEditName();

            console.log('Project name updated:', newName);
        } catch (error) {
            console.error('Error saving project name:', error);
            // Still update locally
            this.currentProject.name = newName;
            localStorage.setItem('heataq_project_name', newName);
            this.updateDisplay();
            this.cancelEditName();
        }
    },

    // Edit project description
    editDescription() {
        const formEl = document.getElementById('project-edit-desc-form');
        const inputEl = document.getElementById('project-desc-input');

        if (inputEl) {
            inputEl.value = this.currentProject?.description || '';
        }
        if (formEl) {
            formEl.style.display = 'block';
        }
        if (inputEl) {
            inputEl.focus();
        }
    },

    // Cancel description edit
    cancelEditDescription() {
        const formEl = document.getElementById('project-edit-desc-form');
        if (formEl) {
            formEl.style.display = 'none';
        }
    },

    // Save project description
    async saveDescription() {
        const inputEl = document.getElementById('project-desc-input');
        const newDesc = inputEl?.value?.trim() || '';

        try {
            // Update in backend (if API supports it)
            const response = await fetch(`${config.API_BASE_URL}?action=updateProject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_id: this.currentProject?.id,
                    description: newDesc
                })
            });

            // Update locally regardless of backend support
            this.currentProject.description = newDesc;
            localStorage.setItem('heataq_project_desc', newDesc);

            // Update display
            this.updateDisplay();
            this.cancelEditDescription();

            console.log('Project description updated');
        } catch (error) {
            console.error('Error saving project description:', error);
            // Still update locally
            this.currentProject.description = newDesc;
            localStorage.setItem('heataq_project_desc', newDesc);
            this.updateDisplay();
            this.cancelEditDescription();
        }
    },

    // Show new project modal
    showNewProjectModal() {
        const modal = document.getElementById('new-project-modal');
        if (modal) {
            modal.style.display = 'flex';
            const nameInput = document.getElementById('new-project-name');
            if (nameInput) {
                nameInput.value = '';
                nameInput.focus();
            }
            const descInput = document.getElementById('new-project-desc');
            if (descInput) {
                descInput.value = '';
            }
        }
    },

    // Hide new project modal
    hideNewProjectModal() {
        const modal = document.getElementById('new-project-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Create new project
    async createNewProject() {
        const nameInput = document.getElementById('new-project-name');
        const descInput = document.getElementById('new-project-desc');

        const name = nameInput?.value?.trim();
        const description = descInput?.value?.trim() || '';

        if (!name) {
            alert('Please enter a project name');
            return;
        }

        try {
            // Create in backend
            const response = await fetch(`${config.API_BASE_URL}?action=createProject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });

            if (response.ok) {
                const newProject = await response.json();

                // Switch to new project
                if (newProject.id) {
                    localStorage.setItem('heataq_project', newProject.id);
                }
                localStorage.setItem('heataq_project_name', name);
                localStorage.setItem('heataq_project_desc', description);

                this.currentProject = {
                    id: newProject.id,
                    name: name,
                    description: description
                };

                // Refresh display
                this.hideNewProjectModal();
                await this.load();

                console.log('New project created:', name);
            } else {
                // Backend might not support project creation yet
                // Create locally only
                const localId = 'local_' + Date.now();
                localStorage.setItem('heataq_project', localId);
                localStorage.setItem('heataq_project_name', name);
                localStorage.setItem('heataq_project_desc', description);

                this.currentProject = {
                    id: localId,
                    name: name,
                    description: description
                };

                this.hideNewProjectModal();
                this.updateDisplay();
                this.loadProjectsList();

                console.log('New project created locally:', name);
            }
        } catch (error) {
            console.error('Error creating project:', error);
            // Create locally as fallback
            const localId = 'local_' + Date.now();
            localStorage.setItem('heataq_project', localId);
            localStorage.setItem('heataq_project_name', name);
            localStorage.setItem('heataq_project_desc', description);

            this.currentProject = {
                id: localId,
                name: name,
                description: description
            };

            this.hideNewProjectModal();
            this.updateDisplay();
            this.loadProjectsList();
        }
    },

    // Switch to a different project
    async switchProject(projectId) {
        if (projectId == this.currentProject?.id) {
            return; // Already on this project
        }

        try {
            // Find project in list
            const project = this.projects.find(p => p.id == projectId);

            if (project) {
                localStorage.setItem('heataq_project', project.id);
                localStorage.setItem('heataq_project_name', project.name);
                localStorage.setItem('heataq_project_desc', project.description || '');

                this.currentProject = {
                    id: project.id,
                    name: project.name,
                    description: project.description
                };

                // Refresh page to load new project data
                window.location.reload();
            }
        } catch (error) {
            console.error('Error switching project:', error);
        }
    }
};

// Export for global use
window.ProjectModule = ProjectModule;

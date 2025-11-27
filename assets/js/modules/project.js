// Project Management Module

const ProjectModule = {
    currentProject: null,
    projects: [],

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

            // Load project summary
            await this.loadSummary();

            // Load projects list
            await this.loadProjectsList();
        } catch (error) {
            console.error('Error loading project:', error);
        }
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
            const weatherResponse = await fetch(`${config.apiBaseUrl}?action=getWeatherRange`);
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
            const response = await fetch(`${config.apiBaseUrl}?action=getSimulationRuns`);
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
            const response = await fetch(`${config.apiBaseUrl}?action=getProjects`);
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
            const response = await fetch(`${config.apiBaseUrl}?action=updateProject`, {
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
            const response = await fetch(`${config.apiBaseUrl}?action=updateProject`, {
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
            const response = await fetch(`${config.apiBaseUrl}?action=createProject`, {
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

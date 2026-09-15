const STORAGE_KEY = "gestione_giri_corrieri_v1";
const exportBtn = document.getElementById("exportBtn");
if (exportBtn) exportBtn.addEventListener("click", esportaJSON);
let state = loadState();
let lastResult = null;
let pinnedAssignments = {};

// Variabili per gestire il trascinamento (Drag & Drop)
let draggedType = null; // "courier" o "route"
let draggedId = null;

const els = {
    matrixContainer: document.getElementById("matrixContainer"),
    presenceContainer: document.getElementById("presenceContainer"),
    newCourierInput: document.getElementById("newCourierInput"),
    addCourierBtn: document.getElementById("addCourierBtn"),
    addRouteBtn: document.getElementById("addRouteBtn"),
    calculateBtn: document.getElementById("calculateBtn"),
    resultsSection: document.getElementById("resultsSection"),
    resultContainer: document.getElementById("resultContainer"),
    resetBtn: document.getElementById("resetBtn"),
    toast: document.getElementById("toast")
};

function createId(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
}

function emptyState() {
    return { 
        corrieri: [], 
        giri: [], 
        competenze: {}, 
        supportiGruppi: {}, 
        numeroGruppiSupporto: 2,
        numeroSponde: 2 
    };
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return typeof DB_INIZIALE !== "undefined" ? JSON.parse(JSON.stringify(DB_INIZIALE)) : emptyState();
        }
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.corrieri) || !Array.isArray(parsed.giri) || typeof parsed.competenze !== "object") {
            return emptyState();
        }
        parsed.corrieri.forEach(c => { if (typeof c.presente !== "boolean") c.presente = true; });
        if (!parsed.supportiGruppi) parsed.supportiGruppi = {};
        if (!parsed.numeroGruppiSupporto) parsed.numeroGruppiSupporto = 2;
        if (!parsed.numeroSponde) parsed.numeroSponde = 2;
        return parsed;
    } catch (error) {
        console.error("Errore caricamento dati:", error);
        return emptyState();
    }
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error("Errore salvataggio:", error);
        showToast("Impossibile salvare i dati nel browser.");
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getScore(routeId, courierId) {
    const value = state.competenze?.[routeId]?.[courierId];
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function setScore(routeId, courierId, score) {
    if (!state.competenze[routeId]) state.competenze[routeId] = {};
    state.competenze[routeId][courierId] = score;
}

function scoreBackground(score) {
    const normalized = Math.min(5, Math.max(0, score));
    const hue = Math.max(0, Math.min(120, normalized * 24));
    return `hsl(${hue}, 76%, ${88 - (normalized * 3.6)}%)`;
}

function render() {
    renderMatrix();
    renderPresence();
    if (lastResult) renderResults(lastResult);
}

function renderMatrix() {
    const container = els.matrixContainer;
    if (!container) return;

    if (state.corrieri.length === 0 && state.giri.length === 0) {
        container.innerHTML = `
      <div class="empty">
        <strong>Nessun dato presente</strong>
        Inserisci almeno un corriere e un giro per visualizzare la matrice.
      </div>`;
        return;
    }

    let html = `
    <div class="matrix-wrap">
      <table class="matrix">
        <thead>
          <tr>
            <th class="route-head corner">Corrieri / Giri</th>
  `;

    state.giri.forEach(route => {
        html += `
      <th draggable="true" data-drag-type="route" data-id="${route.id}">
        <div class="person-head">
          <span class="drag-handle" title="Trascina per riordinare">⋮⋮</span>
          <input type="text" class="route-name-input" value="${escapeHtml(route.nome)}" data-action="rename-route" data-id="${route.id}">
          <div class="head-actions">
            <button type="button" class="icon-btn delete" data-action="delete-route" data-id="${route.id}" title="Elimina giro">✕</button>
          </div>
        </div>
      </th>
    `;
    });

    html += `
          </tr>
        </thead>
        <tbody>
  `;

    state.corrieri.forEach(courier => {
        html += `
      <tr draggable="true" data-drag-type="courier" data-id="${courier.id}">
        <td class="route-cell">
          <div class="route-tools">
            <span class="drag-handle" title="Trascina per riordinare">⋮⋮</span>
            <input type="text" class="person-name-input" value="${escapeHtml(courier.nome)}" data-action="rename-courier" data-id="${courier.id}">
            <button type="button" class="icon-btn delete" data-action="delete-courier" data-id="${courier.id}" title="Elimina corriere">✕</button>
          </div>
        </td>
    `;

        state.giri.forEach(route => {
            const score = getScore(route.id, courier.id);
            // MODIFICA: Ora controlla "score >= 0" e "score !== null" così colora di rosso anche lo 0 fin dal primo caricamento
            const bgStyle = (score !== null && score !== undefined && score >= 0) ? `style="background: ${scoreBackground(score)}"` : "";

            html += `
        <td ${bgStyle}>
          <input type="number" 
                 class="score-input" 
                 min="0" 
                 max="5" 
                 value="${score !== null && score !== undefined ? score : ''}" 
                 data-action="score"
                 data-route="${route.id}"
                 data-courier="${courier.id}">
        </td>
      `;
        });

        html += `</tr>`;
    });

    html += `
        </tbody>
      </table>
    </div>
  `;

    container.innerHTML = html;
}
function renderPresence() {
    if (state.corrieri.length === 0 && state.giri.length === 0) {
        els.presenceContainer.innerHTML = `
          <div class="empty">
            <strong>Nessun dato inserito</strong>
            <span>Inserisci corrieri e giri per configurare le presenze.</span>
          </div>`;
        return;
    }

    if (!state.supportiGruppi) state.supportiGruppi = {};
    const maxGroups = state.numeroGruppiSupporto || 2;
    const numSponde = state.numeroSponde || 2;

    const supportRoutes = state.giri.filter(r => /\b(s|supporto)\b/i.test(r.nome));

    let html = `<div style="display: flex; flex-direction: column; gap: 16px;">`;

    if (state.corrieri.length > 0) {
        html += `
        <div>
          <strong style="display:block; margin-bottom: 8px; font-size: 0.85rem; color: var(--muted);">PRESENZA CORRIERI</strong>
          <div class="presence-list">
            ${state.corrieri.map(courier => `
              <label class="presence-item">
                <input type="checkbox" data-action="presence" data-id="${courier.id}" ${courier.presente ? "checked" : ""}>
                <span class="presence-name">${escapeHtml(courier.nome || "Senza nome")}</span>
              </label>
            `).join("")}
          </div>
        </div>`;
    }

    html += `
    <div style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
      <div style="display: flex; align-items: center; gap: 8px;">
        <label for="groupCountSelect" style="font-size: 0.85rem; font-weight: bold; color: var(--muted);">Numero Supporti:</label>
        <select id="groupCountSelect" data-action="change-group-count" style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border);">
          ${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${n === maxGroups ? "selected" : ""}>${n}</option>`).join("")}
        </select>
      </div>

      <div style="display: flex; align-items: center; gap: 8px;">
        <label for="spondeCountSelect" style="font-size: 0.85rem; font-weight: bold; color: var(--muted);">Numero Sponde:</label>
        <select id="spondeCountSelect" data-action="change-sponde-count" style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border);">
          ${[1, 2, 3].map(n => `<option value="${n}" ${n === numSponde ? "selected" : ""}>${n}</option>`).join("")}
        </select>
      </div>
    </div>`;

    if (supportRoutes.length > 0) {
        html += `
        <div>
          <strong style="display: block; font-size: 0.85rem; color: var(--muted); margin-bottom: 8px;">ATTIVAZIONE E ASSEGNAZIONE ZONE DI SUPPORTO</strong>
          <div class="result-table-wrap">
            <table class="result-table" style="background: #fff; border: 1px solid var(--border); border-radius: 6px;">
              <thead>
                <tr>
                  <th>Zona di Supporto</th>
                  ${Array.from({ length: maxGroups }, (_, i) => `<th style="text-align:center; min-width: 90px;">Gruppo ${i + 1}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${supportRoutes.map(zone => {
            const group = state.supportiGruppi[zone.id];
            return `
                    <tr>
                      <td><strong>${escapeHtml(zone.nome)}</strong></td>
                      ${Array.from({ length: maxGroups }, (_, i) => {
                          const groupNum = i + 1;
                          return `
                          <td style="text-align:center;">
                            <input type="checkbox" data-action="assign-group" data-zone="${zone.id}" data-group="${groupNum}" ${group === groupNum ? "checked" : ""}>
                          </td>`;
                      }).join("")}
                    </tr>`;
        }).join("")}
              </tbody>
            </table>
          </div>
        </div>`;
    }

    html += `</div>`;
    els.presenceContainer.innerHTML = html;
}

function renderResults(result) {
    els.resultsSection.style.display = "block";

    if (!result || !result.assignments) {
        els.resultContainer.innerHTML = `<div class="empty"><strong>Nessuna assegnazione trovata</strong></div>`;
        return;
    }

    // Estrai anche maxScore
    const { activeRoutes, assignments, totalScore, maxScore, unassignedCouriers } = result;
    const availableCouriers = state.corrieri.filter(c => c.presente);

    // Formattazione pulita dei decimali (es. "87.5 / 95" invece di "87.50000 / 95")
    const formattedTotal = Number.isInteger(totalScore) ? totalScore : totalScore.toFixed(1);
    const formattedMax = Number.isInteger(maxScore) ? maxScore : maxScore.toFixed(1);

    let html = `<div style="display: flex; flex-direction: column; gap: 16px;">`;

    html += `
    <div class="result-table-wrap">
      <table class="result-table" style="background: #fff; border: 1px solid var(--border); border-radius: 8px; width: 100%;">
        <thead>
          <tr>
            <th style="min-width: 180px;">Giro / Supporto / Sponda</th>
            <th style="text-align: center; border-left: 1px solid var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 8px;">
                <span>Assegnazione Corriere</span>
                <!-- MODIFICATO QUI: Mostra il punteggio ottenuto rispetto al massimo teorico -->
                <span style="font-size: 0.85rem; color: var(--muted); font-weight: normal;">
                  Punteggio Totale: <strong>${formattedTotal} / ${formattedMax}</strong>
                </span>
              </div>
            </th>
            <th style="width: 90px; text-align: center; border-left: 1px solid var(--border);">Blocca</th>
          </tr>
        </thead>
        <tbody>`;

    activeRoutes.forEach(route => {
        const assignment = assignments.find(a => a.routeId === route.id);
        const selectedCourierId = assignment ? assignment.courierId : "";
        const isPinned = pinnedAssignments.hasOwnProperty(route.id);
        const currentScore = assignment ? assignment.score : 0;

        html += `<tr>
          <td><strong>${escapeHtml(route.nome)}</strong></td>
          <td style="border-left: 1px solid var(--border);">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px;">
              <select class="courier-select" data-route="${route.id}" style="flex: 1; padding: 6px; border-radius: 4px; border: 1px solid var(--border); ${isPinned ? 'font-weight: bold; background: #e0f2fe;' : ''}">
                <option value="">-- Non Assegnato --</option>
                ${availableCouriers.map(c => `<option value="${c.id}" ${c.id === selectedCourierId ? "selected" : ""}>${escapeHtml(c.nome)}</option>`).join("")}
              </select>
              ${selectedCourierId && assignment ? `<span class="score-badge" style="background:${scoreBackground(currentScore)}; min-width: 32px; text-align: center; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${Number.isInteger(currentScore) ? currentScore : currentScore.toFixed(1)}</span>` : ''}
            </div>
          </td>
          <td style="text-align: center; border-left: 1px solid var(--border);">
            <input type="checkbox" class="pin-checkbox" data-route="${route.id}" ${isPinned ? "checked" : ""} title="Blocca questo stato su questo giro per i prossimi ricalcoli">
          </td>
        </tr>`;
    });

    html += `
        </tbody>
      </table>
    </div>`;

    html += `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap;">
      <div style="flex: 1; min-width: 250px; border: 1px solid var(--border); border-radius: 6px; padding: 12px; background: var(--surface-1);">
        <strong style="font-size: 0.85rem; color: var(--muted); display: block; margin-bottom: 6px;">CORRIERI PRESENTI NON ASSEGNATI</strong>`;

    if (unassignedCouriers.length > 0) {
        html += `<ul style="margin: 0; padding-left: 18px; font-size: 0.9rem;">${unassignedCouriers.map(c => `<li>${escapeHtml(c.nome)}</li>`).join("")}</ul>`;
    } else {
        html += `<span style="font-size: 0.85rem; color: var(--muted); font-style: italic;">Tutti i corrieri presenti sono stati assegnati.</span>`;
    }

    html += `
      </div>
      <div>
        <button id="recalculateBtn" class="btn btn-primary" style="padding: 10px 20px;">🔄 Ricalcola Giri Rimanenti</button>
      </div>
    </div></div>`;

    els.resultContainer.innerHTML = html;
    const recalcBtn = document.getElementById("recalculateBtn");
    if (recalcBtn) recalcBtn.addEventListener("click", calculateAssignments);
}

function addCourier() {
    const nameInput = els.newCourierInput;
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }

    const courier = { id: createId("c"), nome: name, presente: true };
    state.corrieri.push(courier);
    state.giri.forEach(route => setScore(route.id, courier.id, 0));

    saveState();
    nameInput.value = "";
    render();
    nameInput.focus();
}

function addRoute() {
    const name = prompt("Nome o numero del nuovo giro:", "");
    if (name === null) return;
    const cleanName = name.trim();
    if (!cleanName) return;

    const route = { id: createId("r"), nome: cleanName };
    state.giri.push(route);
    state.competenze[route.id] = {};
    state.corrieri.forEach(courier => { state.competenze[route.id][courier.id] = 0; });

    saveState();
    render();
}

function renameCourier(id, value) {
    const courier = state.corrieri.find(c => c.id === id);
    if (!courier) return;
    const clean = value.trim();
    if (!clean) { render(); return; }
    courier.nome = clean;
    saveState();
    renderPresence();
    if (lastResult) lastResult = null;
}

function renameRoute(id, value) {
    const route = state.giri.find(r => r.id === id);
    if (!route) return;
    const clean = value.trim();
    if (!clean) { render(); return; }
    route.nome = clean;
    saveState();
    if (lastResult) lastResult = null;
}

function deleteCourier(id) {
    const courier = state.corrieri.find(c => c.id === id);
    if (!courier) return;
    if (!confirm(`Eliminare il corriere "${courier.nome}"?`)) return;

    state.corrieri = state.corrieri.filter(c => c.id !== id);
    Object.keys(state.competenze).forEach(routeId => {
        if (state.competenze[routeId]) delete state.competenze[routeId][id];
    });

    lastResult = null;
    pinnedAssignments = {};
    saveState();
    render();
}

function deleteRoute(id) {
    const route = state.giri.find(r => r.id === id);
    if (!route) return;
    if (!confirm(`Eliminare il giro "${route.nome}"?`)) return;

    state.giri = state.giri.filter(r => r.id !== id);
    delete state.competenze[id];
    if (state.supportiGruppi?.[id]) delete state.supportiGruppi[id];

    lastResult = null;
    delete pinnedAssignments[id];
    saveState();
    render();
}

function updateScore(input) {
    const routeId = input.dataset.route;
    const courierId = input.dataset.courier;
    const raw = input.value.trim();

    if (raw === "") { input.classList.add("invalid"); return; }
    const score = Number(raw);

    if (!Number.isFinite(score) || score < 0 || score > 5) {
        input.classList.add("invalid");
        showToast("Il punteggio deve essere compreso tra 0 e 5.");
        return;
    }

    const normalized = Math.round(score);
    input.value = normalized;
    input.classList.remove("invalid");
    input.closest("td").style.background = scoreBackground(normalized);

    setScore(routeId, courierId, normalized);
    saveState();
    lastResult = null;
}

function updatePresence(id, checked) {
    const courier = state.corrieri.find(c => c.id === id);
    if (!courier) return;
    courier.presente = checked;
    saveState();
    lastResult = null;
}

// LOGICA DI CALCOLO UNGHERESE (HUNGARIAN ALGORITHM)
function calculateAssignments() {
    const availableCouriers = state.corrieri.filter(c => c.presente);
    
    // Individua l'eventuale giro "sponda" nella matrice delle competenze
    const spondaTemplateRoute = state.giri.find(r => /^sponda$/i.test(r.nome.trim()));

    // Filtra i giri escludendo supporti e il giro master "sponda"
    const normalRoutes = state.giri.filter(r => 
        !/\b(s|supporto)\b/i.test(r.nome) && 
        !(spondaTemplateRoute && r.id === spondaTemplateRoute.id)
    );
    const supportZoneRoutes = state.giri.filter(r => /\b(s|supporto)\b/i.test(r.nome));

    const activeRoutes = normalRoutes.map(r => ({ id: r.id, nome: r.nome, type: "normal" }));

    // Aggiunta Gruppi di Supporto
    const maxGroups = state.numeroGruppiSupporto || 2;
    for (let g = 1; g <= maxGroups; g++) {
        const groupZones = supportZoneRoutes.filter(r => state.supportiGruppi?.[r.id] === g);
        if (groupZones.length > 0) {
            const zoneNames = groupZones.map(z => z.nome.replace(/\b(s|supporto)\b\s*/i, "")).join(", ");
            activeRoutes.push({ 
                id: `SUPPORTO_GROUP_${g}`, 
                nome: `Supporto Gruppo ${g} (${zoneNames})`, 
                type: "support_group", 
                zones: groupZones 
            });
        }
    }

    // Aggiunta Sponde dinamiche selezionate (da 1 a 3)
    const numSponde = state.numeroSponde || 2;
    for (let s = 1; s <= numSponde; s++) {
        activeRoutes.push({
            id: `SPONDA_${s}`,
            nome: `Sponda ${s}`,
            type: "sponda"
        });
    }

    if (activeRoutes.length === 0) {
        showToast("Nessun giro, supporto o sponda attivo.");
        return;
    }

    function getEffectiveScore(routeObj, courierId) {
        if (routeObj.type === "sponda") {
            return spondaTemplateRoute ? getScore(spondaTemplateRoute.id, courierId) : 0;
        }
        if (routeObj.type === "normal") return getScore(routeObj.id, courierId);
        if (!routeObj.zones || routeObj.zones.length === 0) return 0;
        let sum = 0;
        routeObj.zones.forEach(zone => { sum += getScore(zone.id, courierId); });
        return Math.round((sum / routeObj.zones.length) * 10) / 10;
    }

    function solveHungarian(costMatrix) {
        const rows = costMatrix.length;
        if (rows === 0) return [];
        const cols = costMatrix[0].length;
        const n = Math.max(rows, cols);

        const matrix = Array.from({ length: n }, (_, r) =>
            Array.from({ length: n }, (_, c) => (r < rows && c < cols ? costMatrix[r][c] : 0))
        );

        const u = new Array(n + 1).fill(0);
        const v = new Array(n + 1).fill(0);
        const p = new Array(n + 1).fill(0);
        const way = new Array(n + 1).fill(0);

        for (let i = 1; i <= n; i++) {
            p[0] = i;
            let j0 = 0;
            const minv = new Array(n + 1).fill(Infinity);
            const used = new Array(n + 1).fill(false);

            do {
                used[j0] = true;
                const i0 = p[j0];
                let delta = Infinity;
                let j1 = 0;

                for (let j = 1; j <= n; j++) {
                    if (!used[j]) {
                        const cur = matrix[i0 - 1][j - 1] - u[i0] - v[j];
                        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                    }
                }

                for (let j = 0; j <= n; j++) {
                    if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else { minv[j] -= delta; }
                }
                j0 = j1;
            } while (p[j0] !== 0);

            do {
                const j1 = way[j0];
                p[j0] = p[j1];
                j0 = j1;
            } while (j0);
        }

        const assignment = new Array(rows).fill(-1);
        for (let j = 1; j <= n; j++) {
            if (p[j] > 0 && p[j] <= rows && (j - 1) < cols) { assignment[p[j] - 1] = j - 1; }
        }
        return assignment;
    }

    const finalAssignments = [];
    const assignedCourierIds = new Set();
    const routesToCalculate = [];

    activeRoutes.forEach(route => {
        const isPinned = pinnedAssignments.hasOwnProperty(route.id);
        const pinnedCourierId = pinnedAssignments[route.id];

        if (isPinned) {
            if (pinnedCourierId) {
                const courier = availableCouriers.find(c => c.id === pinnedCourierId);
                if (courier) {
                    finalAssignments.push({ routeId: route.id, routeName: route.nome, courierId: courier.id, courierName: courier.nome, score: getEffectiveScore(route, courier.id), isPinned: true });
                    assignedCourierIds.add(courier.id);
                } else {
                    finalAssignments.push({ routeId: route.id, routeName: route.nome, courierId: "", courierName: "", score: 0, isPinned: true });
                }
            } else {
                finalAssignments.push({ routeId: route.id, routeName: route.nome, courierId: "", courierName: "", score: 0, isPinned: true });
            }
        } else {
            routesToCalculate.push(route);
        }
    });

    const remainingCouriers = availableCouriers.filter(c => !assignedCourierIds.has(c.id));

    if (routesToCalculate.length > 0 && remainingCouriers.length > 0) {
        const costMatrix = routesToCalculate.map(route => {
            return remainingCouriers.map(courier => {
                const score = getEffectiveScore(route, courier.id);
                return score === 0 ? 50000 : (5 - score) * 10;
            });
        });

        const rowAssignments = solveHungarian(costMatrix);

        rowAssignments.forEach((colIdx, rowIdx) => {
            if (colIdx >= 0 && colIdx < remainingCouriers.length) {
                const route = routesToCalculate[rowIdx];
                const courier = remainingCouriers[colIdx];
                finalAssignments.push({ routeId: route.id, routeName: route.nome, courierId: courier.id, courierName: courier.nome, score: getEffectiveScore(route, courier.id), isPinned: false });
                assignedCourierIds.add(courier.id);
            }
        });
    }

    const totalScore = finalAssignments.reduce((sum, a) => sum + a.score, 0);

    // CALCOLO PUNTEGGIO MASSIMO TEORICO (5 punti max per ogni giro attivo)
    const maxScore = activeRoutes.length * 5;

    const unassignedCouriers = availableCouriers.filter(c => !assignedCourierIds.has(c.id));

    // Salva sia totalScore che maxScore in lastResult
    lastResult = { activeRoutes, assignments: finalAssignments, totalScore, maxScore, unassignedCouriers };
    renderResults(lastResult);
    els.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetData() {
    if (!confirm("Azzera completamente corrieri, giri, competenze e presenze?")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = emptyState();
    lastResult = null;
    pinnedAssignments = {};
    els.resultsSection.style.display = "none";
    els.resultContainer.innerHTML = "";
    render();
    showToast("Dati azzerati.");
}

function esportaJSON() {
    if (!state) {
        showToast("Nessun dato da esportare.");
        return;
    }

    const jsonString = JSON.stringify(state, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "data.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
    showToast("File JSON esportato con successo!");
}

let toastTimer = null;
function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

// --- GESTIONE DRAG & DROP PER RIORDINARE COLONNE E RIGHE ---
els.matrixContainer.addEventListener("dragstart", event => {
    const target = event.target.closest("[draggable='true']");
    if (!target) return;

    if (event.target.tagName === "INPUT") {
        event.preventDefault();
        return;
    }

    draggedType = target.dataset.dragType;
    draggedId = target.dataset.id;
    target.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
});

els.matrixContainer.addEventListener("dragend", event => {
    const target = event.target.closest("[draggable='true']");
    if (target) target.classList.remove("dragging");
    draggedType = null;
    draggedId = null;
});

els.matrixContainer.addEventListener("dragover", event => {
    event.preventDefault();
    const target = event.target.closest("[draggable='true']");
    if (!target || target.dataset.dragType !== draggedType) return;
    event.dataTransfer.dropEffect = "move";
});

els.matrixContainer.addEventListener("drop", event => {
    event.preventDefault();
    const target = event.target.closest("[draggable='true']");
    if (!target || target.dataset.dragType !== draggedType) return;

    const targetId = target.dataset.id;
    if (draggedId === targetId) return;

    if (draggedType === "courier") {
        const fromIdx = state.corrieri.findIndex(c => c.id === draggedId);
        const toIdx = state.corrieri.findIndex(c => c.id === targetId);
        if (fromIdx !== -1 && toIdx !== -1) {
            const [moved] = state.corrieri.splice(fromIdx, 1);
            state.corrieri.splice(toIdx, 0, moved);
            saveState();
            render();
            showToast("Corrieri riordinati.");
        }
    } else if (draggedType === "route") {
        const fromIdx = state.giri.findIndex(r => r.id === draggedId);
        const toIdx = state.giri.findIndex(r => r.id === targetId);
        if (fromIdx !== -1 && toIdx !== -1) {
            const [moved] = state.giri.splice(fromIdx, 1);
            state.giri.splice(toIdx, 0, moved);
            saveState();
            render();
            showToast("Giri riordinati.");
        }
    }
});

// GESTIONI EVENTI STANDARD
els.matrixContainer.addEventListener("change", event => {
    const target = event.target;
    const action = target.dataset.action;
    if (action === "score") updateScore(target);
    else if (action === "rename-courier") renameCourier(target.dataset.id, target.value);
    else if (action === "rename-route") renameRoute(target.dataset.id, target.value);
});

els.matrixContainer.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === "delete-courier") deleteCourier(id);
    if (action === "delete-route") deleteRoute(id);
});

els.presenceContainer.addEventListener("change", event => {
    const target = event.target;
    if (target.dataset.action === "presence") {
        updatePresence(target.dataset.id, target.checked);
    } else if (target.dataset.action === "assign-group") {
        const zoneId = target.dataset.zone;
        const group = Number(target.dataset.group);
        if (!state.supportiGruppi) state.supportiGruppi = {};
        if (target.checked) state.supportiGruppi[zoneId] = group;
        else delete state.supportiGruppi[zoneId];
        saveState();
        lastResult = null;
        renderPresence();
    } else if (target.dataset.action === "change-group-count") {
        const newCount = Number(target.value);
        state.numeroGruppiSupporto = newCount;
        
        if (state.supportiGruppi) {
            Object.keys(state.supportiGruppi).forEach(zoneId => {
                if (state.supportiGruppi[zoneId] > newCount) {
                    delete state.supportiGruppi[zoneId];
                }
            });
        }
        
        saveState();
        lastResult = null;
        renderPresence();
    } else if (target.dataset.action === "change-sponde-count") {
        const newSponde = Number(target.value);
        state.numeroSponde = newSponde;
        saveState();
        lastResult = null;
        renderPresence();
    }
});

els.resultContainer.addEventListener("change", event => {
    const target = event.target;
    if (target.classList.contains("courier-select")) {
        const routeId = target.dataset.route;
        const courierId = target.value;
        if (pinnedAssignments.hasOwnProperty(routeId)) {
            pinnedAssignments[routeId] = courierId;
        }
    }

    if (target.classList.contains("pin-checkbox")) {
        const routeId = target.dataset.route;
        const select = els.resultContainer.querySelector(`select[data-route="${routeId}"]`);
        if (target.checked) {
            pinnedAssignments[routeId] = select ? select.value : "";
            showToast(select && select.value ? "Giro bloccato sul corriere selezionato." : "Giro bloccato su 'Non Assegnato'.");
        } else {
            delete pinnedAssignments[routeId];
            showToast("Sbloccato.");
        }
        if (select) {
            select.style.fontWeight = target.checked ? "bold" : "normal";
            select.style.background = target.checked ? "#e0f2fe" : "#fff";
        }
    }
});

if (els.addCourierBtn) els.addCourierBtn.addEventListener("click", addCourier);
if (els.newCourierInput) {
    els.newCourierInput.addEventListener("keydown", event => {
        if (event.key === "Enter") addCourier();
    });
}
if (els.addRouteBtn) els.addRouteBtn.addEventListener("click", addRoute);
if (els.calculateBtn) els.calculateBtn.addEventListener("click", calculateAssignments);
if (els.resetBtn) els.resetBtn.addEventListener("click", resetData);

render();
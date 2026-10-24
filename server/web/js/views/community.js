// Profile entdecken: Bezüge der Community auf visualizer.coffee durchsuchen und mit einem Klick als Skript übernehmen.
// Übernommen wird der gemessene Druckverlauf als Druckstufen (shared/visualizer.js). Läuft nur über den Server.
import { h, icon, fmt, snackbar, fullscreen } from '../ui.js';
import { api } from '../api.js';
import { shotChart } from '../gauge.js';

const SUGGEST = ['Blooming', 'Londinium', 'Adaptive', 'Allongé', 'Extractamundo', 'Gentle', 'Cremina', 'Turbo'];

export function openCommunity(onImported) {
  fullscreen((root, close) => {
    const details = new Map(); // ID → Promise des umgerechneten Profils
    let page = 1;
    let busy = false;
    const profileIn = h('input', { class: 'text', type: 'search', placeholder: 'Profil, z. B. Blooming', maxlength: 60, 'aria-label': 'Profil' });
    const beanIn = h('input', { class: 'text', type: 'search', placeholder: 'Bohne (optional)', maxlength: 60, 'aria-label': 'Bohne' });
    const minSel = h('select', { class: 'text', 'aria-label': 'Mindestbewertung' },
      [[0, 'Alle Bewertungen'], [70, 'Bewertung ab 70'], [80, 'Bewertung ab 80'], [90, 'Bewertung ab 90']].map(([v, t]) => h('option', { value: v, selected: v === 80 }, t)));
    const list = h('div', { class: 'community-list' });
    const more = h('button', { class: 'btn tonal wide', hidden: true, onclick: () => search(page + 1) }, 'Mehr laden');
    const suggest = h('div', { class: 'chips' }, SUGGEST.map((s) => h('button', { class: 'chip', type: 'button', onclick: () => { profileIn.value = s; search(1); } }, s)));

    async function search(p) {
      if (busy) return;
      busy = true;
      more.disabled = true;
      if (p === 1) list.replaceChildren(h('div', { class: 'empty' }, 'Suche auf visualizer.coffee …'));
      const q = new URLSearchParams({ page: String(p), min: minSel.value });
      if (profileIn.value.trim()) q.set('profile', profileIn.value.trim());
      if (beanIn.value.trim()) q.set('bean', beanIn.value.trim());
      try {
        const r = await api(`/api/community/shots?${q}`);
        page = p;
        if (p === 1) list.replaceChildren();
        if (!r.items.length && p === 1) list.append(h('div', { class: 'empty' }, 'Nichts gefunden. Anderen Profilnamen probieren oder die Mindestbewertung senken.'));
        list.append(...r.items.map(card));
        more.hidden = !r.more;
      } catch (e) {
        if (p === 1) list.replaceChildren(h('div', { class: 'empty' }, e.message));
        else snackbar(e.message);
      } finally {
        busy = false;
        more.disabled = false;
      }
    }

    function detail(id) {
      if (!details.has(id)) details.set(id, api(`/api/community/shots/${encodeURIComponent(id)}`).catch((e) => { details.delete(id); throw e; }));
      return details.get(id);
    }

    function card(it) {
      const box = h('div', { class: 'community-preview', hidden: true });
      const stats = [
        it.dose && it.yield ? `${fmt(it.dose)} g → ${fmt(it.yield)} g` : null,
        it.ratio ? `1:${fmt(it.ratio)}` : null,
        it.time ? `${fmt(it.time, 0)} s` : null,
      ].filter(Boolean).join(' · ');
      const importBtn = h('button', { class: 'btn filled', onclick: () => importIt(it, importBtn) }, icon('download', 's18'), 'Importieren');
      const previewBtn = h('button', { class: 'btn text', 'aria-expanded': 'false', onclick: () => togglePreview(it, box, previewBtn) }, icon('profile', 's18'), 'Vorschau');
      return h('div', { class: 'card community-card' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, it.title),
            h('div', { class: 'small muted' }, [it.user ? `von ${it.user}` : null, it.bean, it.roast].filter(Boolean).join(' · '))),
          it.enjoyment ? h('span', { class: 'badge enjoy', title: 'Bewertung auf visualizer.coffee (0–100)' }, `★ ${it.enjoyment}`) : null),
        stats ? h('div', { class: 'small stats' }, stats) : null,
        box,
        h('div', { class: 'row card-actions' }, previewBtn, h('span', { class: 'grow' }), importBtn));
    }

    async function togglePreview(it, box, btn) {
      const open = box.hidden;
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (!open || box.childElementCount) return;
      box.append(h('div', { class: 'small muted' }, 'Lade Verlauf …'));
      try {
        const d = await detail(it.id);
        const stages = d.steps.filter((s) => s.op === 4 || s.op === 12).length;
        box.replaceChildren(
          h('div', { class: 'chart-box' }, shotChart(d.curve, { width: 640, height: 200, target: d.target })),
          h('p', { class: 'small muted' }, `Linie: gemessen auf der Decent. Gestrichelt: daraus erzeugtes Xenia-Skript „${d.name}“ mit ${stages} Stufen.`),
          d.info.grinder ? h('p', { class: 'small muted' }, `Mühle: ${d.info.grinder}`) : null,
          h('a', { class: 'small ext-link', href: `https://visualizer.coffee/shots/${encodeURIComponent(it.id)}`, target: '_blank', rel: 'noopener noreferrer' }, 'Auf visualizer.coffee ansehen', icon('open', 's16')));
      } catch (e) {
        box.replaceChildren(h('div', { class: 'small muted' }, e.message));
      }
    }

    async function importIt(it, btn) {
      btn.disabled = true;
      try {
        const d = await detail(it.id);
        await api('/api/machine/scripts', { method: 'POST', body: { name: d.name, steps: d.steps, kind: 'standard' } });
        btn.replaceChildren(icon('check', 's18'), 'Importiert');
        snackbar(`„${d.name}“ als Skript gespeichert`);
        onImported?.();
      } catch (e) {
        btn.disabled = false;
        snackbar(e.message);
      }
    }

    root.append(
      h('div', { class: 'row', style: { margin: '4px 0 12px' } },
        h('div', { class: 'grow' }, h('strong', {}, 'Profile entdecken')),
        h('button', { class: 'btn grey', onclick: close }, 'Schließen')),
      h('form', { class: 'card community-search', onsubmit: (e) => { e.preventDefault(); search(1); } },
        profileIn, beanIn, minSel,
        h('button', { class: 'btn filled', type: 'submit' }, icon('search', 's18'), 'Suchen')),
      suggest,
      list,
      more,
      h('p', { class: 'small muted community-note' },
        'Bezüge der Decent-Community auf visualizer.coffee. Übernommen wird der dort gemessene Druckverlauf als Druckstufen – ',
        'Fluss-Regelung, Ausstiegsbedingungen und Temperatur der Decent kann die Xenia per Skript nicht nachbilden. ',
        'Mahlgrad und Dosis musst du für deine Mühle selbst finden; Verhältnis und Zeit des Originals sind ein guter Startpunkt.'));
    search(1);
  });
}

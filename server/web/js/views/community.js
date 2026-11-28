// Profile entdecken: Bezüge der Community auf visualizer.coffee durchsuchen und mit einem Klick als Skript übernehmen.
// Übernommen wird der gemessene Druckverlauf als Druckstufen (shared/visualizer.js). Läuft nur über den Server.
import { h, icon, fmt, snackbar, fullscreen } from '../ui.js';
import { api } from '../api.js';
import { shotChart } from '../gauge.js';
import { t } from '../../shared/i18n.js';

const SUGGEST = ['Blooming', 'Londinium', 'Adaptive', 'Allongé', 'Extractamundo', 'Gentle', 'Cremina', 'Turbo'];

export function openCommunity(onImported, host = fullscreen) {
  host((root, close) => {
    const details = new Map(); // ID → Promise des umgerechneten Profils
    let page = 1;
    let busy = false;
    const profileIn = h('input', { class: 'text', type: 'search', placeholder: t('shots.community.profilePlaceholder'), maxlength: 60, 'aria-label': t('shots.community.profileAria') });
    const beanIn = h('input', { class: 'text', type: 'search', placeholder: t('shots.community.beanPlaceholder'), maxlength: 60, 'aria-label': t('shots.community.beanAria') });
    const minSel = h('select', { class: 'text', 'aria-label': t('shots.community.minAria') },
      [[0, t('shots.community.minAll')], [70, t('shots.community.minFrom', { n: 70 })], [80, t('shots.community.minFrom', { n: 80 })], [90, t('shots.community.minFrom', { n: 90 })]].map(([v, label]) => h('option', { value: v, selected: v === 80 }, label)));
    const list = h('div', { class: 'community-list' });
    const more = h('button', { class: 'btn tonal wide', hidden: true, onclick: () => search(page + 1) }, t('shots.community.more'));
    const suggest = h('div', { class: 'chips' }, SUGGEST.map((s) => h('button', { class: 'chip', type: 'button', onclick: () => { profileIn.value = s; search(1); } }, s)));

    async function search(p) {
      if (busy) return;
      busy = true;
      more.disabled = true;
      if (p === 1) list.replaceChildren(h('div', { class: 'empty' }, t('shots.community.searching')));
      const q = new URLSearchParams({ page: String(p), min: minSel.value });
      if (profileIn.value.trim()) q.set('profile', profileIn.value.trim());
      if (beanIn.value.trim()) q.set('bean', beanIn.value.trim());
      try {
        const r = await api(`/api/community/shots?${q}`);
        page = p;
        if (p === 1) list.replaceChildren();
        if (!r.items.length && p === 1) list.append(h('div', { class: 'empty' }, t('shots.community.nothing')));
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
      const importBtn = h('button', { class: 'btn filled', onclick: () => importIt(it, importBtn) }, icon('download', 's18'), t('shots.community.import'));
      const previewBtn = h('button', { class: 'btn text', 'aria-expanded': 'false', onclick: () => togglePreview(it, box, previewBtn) }, icon('profile', 's18'), t('shots.community.preview'));
      return h('div', { class: 'card community-card' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, it.title),
            h('div', { class: 'small muted' }, [it.user ? t('shots.community.byUser', { user: it.user }) : null, it.bean, it.roast].filter(Boolean).join(' · '))),
          it.enjoyment ? h('span', { class: 'badge enjoy', title: t('shots.community.enjoymentTitle') }, `★ ${it.enjoyment}`) : null),
        stats ? h('div', { class: 'small stats' }, stats) : null,
        box,
        h('div', { class: 'row card-actions' }, previewBtn, h('span', { class: 'grow' }), importBtn));
    }

    async function togglePreview(it, box, btn) {
      const open = box.hidden;
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (!open || box.childElementCount) return;
      box.append(h('div', { class: 'small muted' }, t('shots.community.loadingCurve')));
      try {
        const d = await detail(it.id);
        const stages = d.steps.filter((s) => s.op === 4 || s.op === 12).length;
        box.replaceChildren(
          h('div', { class: 'chart-box' }, shotChart(d.curve, { width: 640, height: 200, target: d.target })),
          h('p', { class: 'small muted' }, t('shots.community.previewNote', { name: d.name, n: stages })),
          d.info.grinder ? h('p', { class: 'small muted' }, t('shots.community.grinder', { grinder: d.info.grinder })) : null,
          h('a', { class: 'small ext-link', href: `https://visualizer.coffee/shots/${encodeURIComponent(it.id)}`, target: '_blank', rel: 'noopener noreferrer' }, t('shots.community.open'), icon('open', 's16')));
      } catch (e) {
        box.replaceChildren(h('div', { class: 'small muted' }, e.message));
      }
    }

    async function importIt(it, btn) {
      btn.disabled = true;
      try {
        const d = await detail(it.id);
        await api('/api/machine/scripts', { method: 'POST', body: { name: d.name, steps: d.steps, kind: 'standard' } });
        btn.replaceChildren(icon('check', 's18'), t('shots.community.imported'));
        snackbar(t('shots.community.savedAsScript', { name: d.name }));
        onImported?.();
      } catch (e) {
        btn.disabled = false;
        snackbar(e.message);
      }
    }

    root.append(
      // Als Unterseite stehen Titel und Zurück-Pfeil schon in der Kopfzeile
      host.page ? null : h('div', { class: 'row', style: { margin: '4px 0 12px' } },
        h('div', { class: 'grow' }, h('strong', {}, t('shots.community.title'))),
        h('button', { class: 'btn grey', onclick: close }, t('common.close'))),
      h('form', { class: 'card community-search', onsubmit: (e) => { e.preventDefault(); search(1); } },
        profileIn, beanIn, minSel,
        h('button', { class: 'btn filled', type: 'submit' }, icon('search', 's18'), t('shots.community.search'))),
      suggest,
      list,
      more,
      h('p', { class: 'small muted community-note' }, t('shots.community.note')));
    search(1);
  });
}

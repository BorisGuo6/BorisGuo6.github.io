// Main JavaScript file for BorisGuo6.github.io
// Contains all interactive functionality for the personal website

// ============================================================================
// Minimal / Full Mode
// ============================================================================
window.siteFullMode = false;
var _profileClickCount = 0;
var _profileClickTimer = null;

function handleProfileClick() {
  clearTimeout(_profileClickTimer);
  _profileClickCount++;
  _profileClickTimer = setTimeout(function () { _profileClickCount = 0; }, 2000);
  if (_profileClickCount >= 5) {
    _profileClickCount = 0;
    clearTimeout(_profileClickTimer);
    window.siteFullMode = !window.siteFullMode;
    applyMode(window.siteFullMode);
  }
}

function applyMode(full) {
  window.siteFullMode = full;
  var hideInMinimal = [
    'more-academic-links-wrap', 'news-phd-offer',
    'section-research-proposal', 'section-toggle-papers',
    'section-toggle-awards', 'section-talks', 'section-org-entre'
  ];
  var showInMinimal = ['scholar-link-note'];
  hideInMinimal.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = full ? '' : 'none';
  });
  showInMinimal.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = full ? 'none' : '';
  });
  if (window._cachedPublications) renderNews(window._cachedPublications);
  if (window._cachedSections) renderSiteAwards(window._cachedSections.awards);
}

function buildTimelineDetailTableMinimal(d) {
  const heading = d.nameHtml
    ? d.nameHtml + (d.location ? `, ${d.location}` : '')
    : (d.name || '') + (d.location ? `, ${d.location}` : '');
  const datesSpan = d.dates ? `<span class="dates">${d.dates}</span>` : '';
  const rolePart = d.role
    ? (d.roleBold ? `<b>${d.role}</b>` : d.role) + '<br>'
    : '';
  const h3Title = datesSpan ? `${heading} ${datesSpan}` : heading;
  return `<table style="width:100%; border:none; padding:0px;"><tbody><tr>
<td style="padding:25px; width:15%; vertical-align:middle; padding-top:20px;">
<img src="${d.logo}" style="width:100%; height:auto;" alt="" loading="lazy">
</td>
<td style="padding-top:20px; padding-left:20px; padding-right:20px; width:85%; vertical-align:top;">
<h3>${h3Title}</h3>
${rolePart}
</td></tr></tbody></table>`;
}

// Apply minimal mode immediately (script runs after DOM is parsed since it's at bottom of body)
applyMode(false);

// ============================================================================
// Academic Links Modal Functions
// ============================================================================
function openAcademicLinks() {
  document.getElementById("AcademicLinksModal").style.display = "block";
}

function closeAcademicLinks() {
  document.getElementById("AcademicLinksModal").style.display = "none";
}

// ============================================================================
// WeChat Modal Functions
// ============================================================================
function openWeChatModal() {
  document.getElementById("WeChatModal").style.display = "block";
}

function closeWeChatModal() {
  document.getElementById("WeChatModal").style.display = "none";
}

// ============================================================================
// Awards Modal Functions
// ============================================================================
var currentAwardType = 'personal';
var awardImages = {};

function openAward(imagePath, imageAlt, personalPath, teamPath) {
  var modal = document.getElementById("AwardModal");
  var img = document.getElementById("awardImage");
  var toggleButtons = document.getElementById("awardToggleButtons");
  var credentialLink = document.getElementById("credentialLink");

  if (personalPath && teamPath) {
    awardImages.personal = personalPath;
    awardImages.team = teamPath;
    toggleButtons.style.display = "block";
    credentialLink.style.display = "block";
    switchAward('personal');
  } else {
    awardImages = {};
    toggleButtons.style.display = "none";
    credentialLink.style.display = "none";
    img.src = imagePath;
    img.alt = imageAlt;
  }

  modal.style.display = "block";
}

function switchAward(type) {
  currentAwardType = type;
  var img = document.getElementById("awardImage");
  var personalBtn = document.getElementById("personalAwardBtn");
  var teamBtn = document.getElementById("teamAwardBtn");
  var credentialLink = document.getElementById("credentialLink");

  if (type === 'personal') {
    img.src = awardImages.personal;
    img.alt = "ICRA 2025 Best Paper Award - Personal Certificate";
    personalBtn.style.backgroundColor = "#77BBDD";
    personalBtn.style.color = "white";
    teamBtn.style.backgroundColor = "#cccccc";
    teamBtn.style.color = "#666666";
    credentialLink.style.display = "block";
  } else {
    img.src = awardImages.team;
    img.alt = "ICRA 2025 Best Paper Award - Team Certificate";
    teamBtn.style.backgroundColor = "#77BBDD";
    teamBtn.style.color = "white";
    personalBtn.style.backgroundColor = "#cccccc";
    personalBtn.style.color = "#666666";
    credentialLink.style.display = "none";
  }
}

function closeAward() {
  document.getElementById("AwardModal").style.display = "none";
}

// Full-size preview for paper thumbnails, profile photo, org logos (same modal as certificates).
function openImagePreview(imagePath, imageAlt) {
  openAward(imagePath, imageAlt || "");
}

// ============================================================================
// Publications Toggle Functions
// ============================================================================
function togglePapers() {
  const hiddenPapers = document.querySelectorAll('.hidden-paper');
  const highlightPapers = document.querySelectorAll('.highlight-paper');
  const highlightPapersLight = document.querySelectorAll('.highlight-paper-light');
  const toggleText = document.getElementById('togglePapersText');
  const toggleIcon = document.getElementById('togglePapersIcon');
  const titleElement = document.querySelector('#publications-title');
  const highlightNote = document.querySelector('#highlight-note');
  if (!hiddenPapers.length) return;
  const isHidden = hiddenPapers[0].style.display === 'none';

  hiddenPapers.forEach(paper => {
    paper.style.display = isHidden ? 'table-row' : 'none';
  });
  highlightPapers.forEach(paper => {
    paper.style.backgroundColor = isHidden ? 'rgba(102, 192, 255, 0.2)' : '';
  });
  highlightPapersLight.forEach(paper => {
    paper.style.backgroundColor = isHidden ? 'rgba(102, 192, 255, 0.15)' : '';
  });
  if (highlightNote) highlightNote.style.display = isHidden ? 'inline' : 'none';
  if (toggleText) toggleText.textContent = isHidden ? 'Show Selected Publications' : 'Show All Publications';
  if (toggleIcon) toggleIcon.textContent = isHidden ? '▲' : '▼';
  if (titleElement) titleElement.textContent = isHidden ? 'Publications' : 'Selected Publications';
}

// ============================================================================
// Awards Toggle Functions
// ============================================================================
function toggleAwards() {
  const hiddenAwards = document.querySelectorAll('.hidden-award');
  const toggleText = document.getElementById('toggleText');
  const toggleIcon = document.getElementById('toggleIcon');
  if (!hiddenAwards.length) return;
  const isHidden = hiddenAwards[0].style.display === 'none';

  hiddenAwards.forEach(award => {
    award.style.display = isHidden ? 'block' : 'none';
  });
  if (toggleText) toggleText.textContent = isHidden ? 'Show Less Awards' : 'Show More Awards';
  if (toggleIcon) toggleIcon.textContent = isHidden ? '▲' : '▼';
}

// ============================================================================
// Shared: paper-link-btn row (timeline details + org / entrepreneurship)
// ============================================================================
function buildBtnLinksRow(links) {
  if (!links || !links.length) return '';
  return '<br>' + links.map(function (l, i) {
    const sep = i ? '&nbsp;/&nbsp;' : '';
    if (l.openAward && l.url) {
      const pathEsc = String(l.url).replace(/'/g, "\\'");
      const titleEsc = escapeJsForSingleQuotedAttr(l.awardTitle || l.label);
      const oc = "openAward('" + pathEsc + "','" + titleEsc + "')";
      return sep + '<a href="javascript:void(0)" class="paper-link-btn" onclick="' + oc + '">' + l.label + '</a>';
    }
    return sep + '<a href="' + l.url + '" class="paper-link-btn">' + l.label + '</a>';
  }).join('');
}

function escapeJsForSingleQuotedAttr(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ');
}

function buildOpenAwardOnclickFromModal(modal) {
  if (!modal) return '';
  if (modal.type === 'dual') {
    return "openAward('','" + escapeJsForSingleQuotedAttr(modal.title) + "','" + modal.personal + "','" + modal.team + "')";
  }
  return "openAward('" + modal.image + "','" + escapeJsForSingleQuotedAttr(modal.title) + "')";
}

// ============================================================================
// Site sections (content/site-sections.json): Award, Talks, Organization, Entrepreneurship
// ============================================================================
function renderSiteAwards(awards) {
  const ul = document.getElementById('awardList');
  if (!ul || !awards || !awards.length) return;
  const minimal = !window.siteFullMode;
  ul.innerHTML = awards.map(function (a) {
    const liClass = a.hidden ? ' class="hidden-award" style="display: none;"' : '';
    if (minimal) {
      return '<li' + liClass + '><span style="font-size: 16px;"><b>' + a.linkLabel + '</b>' +
        (a.afterBold || '') + '</span>' +
        '<span style="font-size: 16px;" class="year"><i>' + a.year + '</i></span></li>';
    }
    const onclick = buildOpenAwardOnclickFromModal(a.modal);
    return '<li' + liClass + '><span style="font-size: 16px;"><b><a href="javascript:void(0)" onclick="' + onclick + '">' +
      a.linkLabel + '</a></b>' + (a.afterBold || '') + '</span>' +
      '<span style="font-size: 16px;" class="year"><i>' + a.year + '</i></span></li>';
  }).join('');
}

function renderTalkPartsHtml(parts) {
  let html = '';
  (parts || []).forEach(function (p) {
    if (p.text != null && p.text !== '') html += p.text;
    if (p.link) html += '<a href="' + p.link + '">' + p.label + '</a>';
    if (p.modalLink) {
      const m = p.modalLink;
      const st = m.underline ? 'text-decoration: underline; cursor: pointer;' : '';
      const oc = buildOpenAwardOnclickFromModal({ type: 'single', image: m.image, title: m.title });
      html += '<a href="javascript:void(0)" onclick="' + oc + '" style="' + st + '">' + m.label + '</a>';
    }
  });
  return html;
}

function renderSiteTalks(talks) {
  const ul = document.getElementById('talks-list');
  if (!ul || !talks || !talks.length) return;
  ul.innerHTML = talks.map(function (t) {
    return '<li>[' + t.date + '] ' + renderTalkPartsHtml(t.parts) + '</li>';
  }).join('');
}

function buildAffiliationCard(e) {
  const extras = (e.extras || []).map(function (x) { return '<br>' + x; }).join('');
  const links = buildBtnLinksRow(e.links);
  const imgPathEsc = String(e.image).replace(/'/g, "\\'");
  const imgClick = 'onclick="openImagePreview(\'' + imgPathEsc + '\',\'' + escapeJsForSingleQuotedAttr(e.name) + '\')" title="Click to enlarge"';
  return '<table style="width:100%; border:none; padding:0px; margin-bottom: 20px;"><tbody><tr>' +
    '<td style="padding:25px; width:30%; vertical-align:middle; padding-top:20px;">' +
    '<img class="hoverZoomLink" src="' + e.image + '" style="width:100%; height:auto;" alt="" loading="lazy" ' + imgClick + '></td>' +
    '<td style="padding-top:20px; padding-left:20px; padding-right:20px; width:70%; vertical-align:top;">' +
    '<h3>' + e.name + '</h3><b>' + e.role + '</b><br>' +
    '<span class="dates" style="float: none;">' + e.dates + '</span>' +
    extras + links +
    '</td></tr></tbody></table>';
}

function renderAffiliationBlock(containerId, entries) {
  const el = document.getElementById(containerId);
  if (!el || !entries || !entries.length) return;
  el.innerHTML = entries.map(buildAffiliationCard).join('');
}

function renderSiteSections(sections) {
  if (!sections) return;
  renderSiteAwards(sections.awards);
  renderSiteTalks(sections.talks);
  renderAffiliationBlock('org-entries', sections.organization);
  renderAffiliationBlock('entre-entries', sections.entrepreneurship);
}

// ============================================================================
// Timeline (content/timeline.json)
// ============================================================================
function buildTimelineDetailTable(id, d) {
  const heading = d.nameHtml
    ? `${d.nameHtml}${d.location ? `, ${d.location}` : ''}`
    : `${d.name || ''}${d.location ? `, ${d.location}` : ''}`;
  const datesSpan = d.dates ? `<span class="dates">${d.dates}</span>` : '';
  const rolePart = d.role
    ? (d.roleBold ? `<b>${d.role}</b>` : d.role) + '<br>'
    : '';
  const extras = (d.extras || []).map(function (x) { return x + '<br>'; }).join('');
  const links = buildBtnLinksRow(d.links);
  const h3Title = datesSpan ? `${heading} ${datesSpan}` : heading;
  return `<table id="${id}" style="width:98%; margin-left:20px; border:none; padding:0px;"><tbody><tr>
<td style="padding:25px; width:15%; vertical-align:middle; padding-top:20px;">
<img src="${d.logo}" style="width:100%; height:auto;" alt="" loading="lazy">
</td>
<td style="padding-top:20px; padding-left:20px; padding-right:20px; width:85%; vertical-align:top;">
<h3>${h3Title}</h3>
${rolePart}
${extras}
${links}
</td></tr></tbody></table>`;
}

function renderTimelineDetails(details) {
  const host = document.getElementById('tl-detail-sources');
  if (!host || !details) return;
  host.innerHTML = Object.keys(details).map(function (id) {
    return buildTimelineDetailTable(id, details[id]);
  }).join('\n');
}

function renderTimelineChart(timeline) {
  const mount = document.getElementById('cv-timeline');
  if (!mount || !timeline) return;

  const BREAK = new Date('2024-07-01');
  const TOP = new Date('2027-03-01');
  const BOT = new Date('2021-01-01');
  const H_TOP = 480;
  const H_BOT = 90;
  const H = H_TOP + H_BOT;

  function toY(yr, mo) {
    const d = new Date(yr, mo - 1, 1);
    if (d >= BREAK) {
      return (TOP - d) / (TOP - BREAK) * H_TOP;
    }
    return H_TOP + (BREAK - d) / (BREAK - BOT) * H_BOT;
  }

  const edu = timeline.edu;
  const res = timeline.res;
  const emp = timeline.emp;

  function barHTML(item, color) {
    const top = toY(item.ey, item.em);
    const bot = toY(item.sy, item.sm);
    const h = Math.max(bot - top, 18);
    const showSub = h > 30;
    let left; let right; let bg; let radius; let showLabel;
    if (item.lstrip) {
      left = '1px'; right = 'calc(60% - 1px)'; bg = color;
      radius = '4px 0 0 0'; showLabel = false;
    } else if (item.rside) {
      left = 'calc(42% + 1px)'; right = '1px'; bg = '#A8D4E8';
      radius = '4px'; showLabel = true;
    } else if (item.label === 'HITSZ' && !item.lstrip) {
      left = '1px'; right = '1px'; bg = color;
      radius = '0 4px 4px 4px'; showLabel = true;
    } else if (item.light) {
      left = '1px'; right = '1px'; bg = '#A8D4E8';
      radius = '4px'; showLabel = true;
    } else {
      left = '1px'; right = '1px'; bg = color;
      radius = '4px'; showLabel = true;
    }
    const safeId = (item.id || '').replace(/'/g, "\\'");
    return `<div style="
                  position:absolute;
                  top:${top.toFixed(1)}px;
                  left:${left};
                  right:${right};
                  height:${h.toFixed(1)}px;
                  background:${bg};
                  border-radius:${radius};
                  padding:3px 5px;
                  box-sizing:border-box;
                  overflow:hidden;
                  cursor:pointer;
                  z-index:1;
                  box-shadow:0 1px 4px rgba(0,0,0,0.12);
                  transition:filter 0.15s;
                " onmouseenter="this.style.filter='brightness(1.1)'" onmouseleave="this.style.filter=''" title="${item.label} · ${item.sub}" onclick="tlShowDetail('${safeId}')">
                  ${showLabel ? `<div style="font-size:10px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">${item.label}</div>` : ''}
                  ${showLabel && showSub ? `<div style="font-size:9px;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">${item.sub}</div>` : ''}
                </div>`;
  }

  function colHTML(items, colorMain) {
    let inner = '';
    for (let yr = 2022; yr <= 2027; yr++) {
      const y = toY(yr, 1);
      inner += `<div style="position:absolute;top:${y.toFixed(1)}px;left:0;right:0;border-top:1px dashed #e0e0e0;pointer-events:none;"></div>`;
    }
    items.forEach(function (item) { inner += barHTML(item, colorMain); });
    return `<div style="position:relative;height:${H}px;background:#fafafa;border-radius:6px;border:1px solid #eee;">${inner}</div>`;
  }

  let axis = `<div style="position:relative;height:${H}px;">`;
  for (let yr = 2027; yr >= 2021; yr--) {
    const y = toY(yr, 1);
    axis += `<span style="position:absolute;top:${(y - 8).toFixed(1)}px;right:6px;font-size:11px;color:#aaa;font-family:monospace;">${yr}</span>`;
  }
  const presentY = toY(2027, 1);
  axis += `<span style="position:absolute;top:${(presentY + 2).toFixed(1)}px;right:6px;font-size:9px;color:#bbb;font-family:monospace;">Now</span>`;
  axis += '</div>';

  const html = `
                <style>
                  .tl-header { font-size:13px; font-weight:700; text-align:center; padding-bottom:8px; letter-spacing:0.04em; }
                </style>
                <div style="display:grid;grid-template-columns:44px 1fr 1fr 1fr;gap:8px;width:100%;">
                  <div></div>
                  <div class="tl-header" style="color:#77BBDD;">Education</div>
                  <div class="tl-header" style="color:#4DB6A0;">Research</div>
                  <div class="tl-header" style="color:#FFA03C;">Employment</div>
                  ${axis}
                  ${colHTML(edu, '#77BBDD')}
                  ${colHTML(res, '#4DB6A0')}
                  ${colHTML(emp, '#FFA03C')}
                </div>`;

  mount.innerHTML = html;

  window.tlShowDetail = function (id) {
    if (!id) return;
    const panel = document.getElementById('tl-detail-panel');
    const content = document.getElementById('tl-detail-content');
    if (!panel || !content) return;
    if (!window.siteFullMode && window._cachedTimeline && window._cachedTimeline.details[id]) {
      content.innerHTML = buildTimelineDetailTableMinimal(window._cachedTimeline.details[id]);
    } else {
      const src = document.getElementById(id);
      if (!src) return;
      const clone = src.cloneNode(true);
      clone.removeAttribute('id');
      clone.style.display = '';
      clone.style.width = '100%';
      clone.style.marginLeft = '0';
      content.innerHTML = '';
      content.appendChild(clone);
    }
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
}

function initTimeline(timeline) {
  renderTimelineDetails(timeline.details);
  renderTimelineChart(timeline);
}

// ============================================================================
// Publications Rendering
// ============================================================================
function buildVenueHtml(venue) {
  if (venue.type === 'accepted') {
    return `<span class="accepted-venue">${venue.label}</span>&nbsp;<span class="accepted-venue-detail">${venue.detail}</span>`;
  }
  if (venue.type === 'presentation') {
    const event = venue.eventUrl
      ? `<a href="${venue.eventUrl}" style="color:#77BBDD">@ ${venue.eventName}</a>`
      : (venue.eventName ? `@ ${venue.eventName}` : '');
    return `<span class="strong-venue"><i class="fa-solid fa-star"></i> ${venue.label} ${event}<i class="fa-solid fa-star"></i></span>`;
  }
  if (venue.type === 'award') {
    const onclick = `openAward('${venue.img}','${escapeJsForSingleQuotedAttr(venue.awardTitle)}')`;
    const suffix = venue.suffix || '';
    const eventHtml = venue.eventUrl
      ? `<a href="${venue.eventUrl}" style="color:#ffa03c">@ ${venue.eventName}</a>`
      : (venue.eventName ? `@ ${venue.eventName}` : '');
    return `<span class="award-venue"><i class="fa-solid fa-trophy"></i> <a href="javascript:void(0)" class="award-venue" onclick="${onclick}">${venue.label}</a>${suffix} ${eventHtml}<i class="fa-solid fa-trophy"></i></span>`;
  }
  if (venue.type === 'award-multi') {
    const onclick = `openAward('','${escapeJsForSingleQuotedAttr(venue.awardTitle)}','${venue.img1}','${venue.img2}')`;
    const suffix = venue.suffix || '';
    const eventHtml = venue.eventUrl
      ? `<a href="${venue.eventUrl}" style="color:#ffa03c">@ ${venue.eventName}</a>`
      : (venue.eventName ? `@ ${venue.eventName}` : '');
    return `<span class="award-venue"><i class="fa-solid fa-trophy"></i> <a href="javascript:void(0)" class="award-venue" onclick="${onclick}">${venue.label}</a>${suffix} ${eventHtml}<i class="fa-solid fa-trophy"></i></span>`;
  }
  if (venue.type === 'status') {
    return `<span class="strong-venue">${venue.label}</span>`;
  }
  return '';
}

function buildPaperRow(paper) {
  const rowClass = paper.display === 'highlight' ? 'highlight-paper'
    : paper.display === 'highlight-light' ? 'highlight-paper-light'
    : 'hidden-paper';
  const rowStyle = rowClass === 'hidden-paper' ? ' style="display:none;"' : '';
  const shadow = paper.imageShadowBlue
    ? 'box-shadow:0 3px 12px 0 #77BBDD;'
    : 'box-shadow:0 4px 15px 0 rgba(0,0,0,0.3);';

  const authorsHtml = paper.authors.map(a => {
    const cls = a.self ? 'strong-author' : 'author';
    const star = a.equal ? '*' : '';
    return `<span class="${cls}">${a.name}${star}</span>`;
  }).join(',\n');

  const linksHtml = paper.links.map((l, i) => {
    const sep = i > 0 ? '\n&nbsp;/&nbsp;\n' : '';
    return l.url
      ? `${sep}<a href="${l.url}" class="paper-link-btn">${l.label}</a>`
      : `${sep}<span class="paper-link-btn">${l.label}</span>`;
  }).join('');

  const venuesHtml = paper.venues.map(v => '<br>' + buildVenueHtml(v)).join('');

  let mediaTd;
  if (paper.video) {
    mediaTd = `<td style="padding:10px;width:30%;vertical-align:middle">
    <video autoplay loop muted playsinline style="width:100%;height:auto;${shadow}">
      <source src="${paper.video.webm}" type="video/webm">
      <source src="${paper.video.mp4}" type="video/mp4">
    </video>
  </td>`;
  } else {
    const imgPathEsc = String(paper.image).replace(/'/g, "\\'");
    const figClick = `onclick="openImagePreview('${imgPathEsc}','${escapeJsForSingleQuotedAttr(paper.title)}')" title="Click to enlarge"`;
    mediaTd = `<td style="padding:10px;width:30%;vertical-align:middle">
    <img class="hoverZoomLink" src="${paper.image}" style="width:100%;height:auto;cursor:pointer;${shadow}" alt="" loading="lazy" ${figClick}>
  </td>`;
  }

  return `<tr class="${rowClass}"${rowStyle}>
  ${mediaTd}
  <td style="padding:10px;width:70%;vertical-align:middle">
    <span class="papertitle">${paper.title}</span>
    <br>
    <i>${authorsHtml}</i>
    <br>
    ${linksHtml}
    ${venuesHtml}
    <br>
    <div class="TLDR"><strong>TL;DR:</strong> ${paper.tldr}</div>
  </td>
</tr>`;
}

function renderPublications(papers) {
  const tbody = document.getElementById('publications-tbody');
  if (!tbody) return;
  tbody.innerHTML = papers.map(buildPaperRow).join('\n');
  // Re-run MathJax typesetting on the new content
  if (window.MathJax && MathJax.Hub) {
    MathJax.Hub.Queue(['Typeset', MathJax.Hub, tbody]);
  }
}

// ============================================================================
// News Rendering (auto-generated from content/publications.json)
// ============================================================================
function buildNewsFromPublications(papers) {
  const rawItems = [];

  papers.forEach(paper => {
    // Find best URL for this paper (first link with a URL)
    const firstLink = paper.links.find(l => l.url);
    const paperUrl = firstLink ? firstLink.url : null;

    paper.venues.forEach(venue => {
      if (!venue.newsDate) return;

      if (venue.type === 'accepted') {
        rawItems.push({
          date: venue.newsDate,
          type: 'acceptance',
          paperTitle: paper.newsShort || paper.title,
          paperUrl: paperUrl,
          venue: venue.label,
          note: venue.newsNote || null
        });
      } else if (venue.type === 'award' || venue.type === 'award-multi') {
        rawItems.push({
          date: venue.newsDate,
          type: 'award',
          paperTitle: venue.newsTitle || paper.newsShort || paper.title,
          paperUrl: paperUrl,
          award: venue.newsAward || venue.label,
          event: venue.newsEvent || null,
          eventUrl: venue.newsEventUrl || null,
          bold: venue.newsBold || false,
          paperDisplay: paper.display
        });
      }
    });
  });

  // Sort descending by date string (YYYY/MM format sorts correctly lexicographically)
  rawItems.sort((a, b) => b.date.localeCompare(a.date));

  // Group acceptance items with same date+venue into one entry
  const grouped = [];
  const acceptMap = {};

  rawItems.forEach(item => {
    if (item.type === 'acceptance') {
      const key = `${item.date}|${item.venue}`;
      if (!acceptMap[key]) {
        const entry = { date: item.date, type: 'acceptance', papers: [], venue: item.venue, note: item.note };
        acceptMap[key] = entry;
        grouped.push(entry);
      }
      acceptMap[key].papers.push({ title: item.paperTitle, url: item.paperUrl });
    } else {
      grouped.push(item);
    }
  });

  // Re-sort after grouping
  grouped.sort((a, b) => b.date.localeCompare(a.date));
  return grouped;
}

function buildNewsItemHtml(item, minimal) {
  if (item.type === 'acceptance') {
    if (minimal) {
      const n = item.papers.length;
      const note = item.note ? ' as ' + item.note : '';
      return `[${item.date}] 🎉 ${n} paper${n === 1 ? '' : 's'} accepted to ${item.venue}${note}!`;
    }
    const papersHtml = item.papers.map((p, i) => {
      const link = p.url ? `<a href="${p.url}">${p.title}</a>` : p.title;
      if (item.papers.length === 1) return link;
      if (i === item.papers.length - 1) return 'and ' + link;
      return link;
    }).join(', ');
    const verb = item.papers.length === 1 ? 'was' : 'were';
    const note = item.note ? ' as ' + item.note : '';
    return `[${item.date}] 🎉 ${papersHtml} ${verb} accepted to ${item.venue}${note}!`;
  }
  if (item.type === 'award') {
    const titleInner = item.bold ? `<b>${item.paperTitle}</b>` : item.paperTitle;
    const paperHtml = item.paperUrl ? `<a href="${item.paperUrl}">${titleInner}</a>` : titleInner;
    const awardHtml = '<strong style="color:rgba(255, 69, 58, 1);">' + item.award + '</strong>';
    const eventPart = item.event
      ? ` at ${item.eventUrl ? `<a href="${item.eventUrl}">${item.event}</a>` : item.event}!`
      : '!';
    return `[${item.date}] 🏅 ${paperHtml} won the ${awardHtml}${eventPart}`;
  }
  return '';
}

function renderNews(papers) {
  const ul = document.getElementById('news-list');
  if (!ul) return;
  while (ul.children.length > 1) {
    ul.removeChild(ul.lastChild);
  }
  const minimal = !window.siteFullMode;
  let items = buildNewsFromPublications(papers);
  if (minimal) {
    items = items.filter(function (item) {
      if (item.type !== 'award') return true;
      return item.paperDisplay === 'highlight' || item.paperDisplay === 'highlight-light';
    });
  }
  const liHtml = items.map(item => `<li>${buildNewsItemHtml(item, minimal)}</li>`).join('\n');
  ul.insertAdjacentHTML('beforeend', liHtml);
  // Re-run MathJax for any math in paper titles
  if (window.MathJax && MathJax.Hub) {
    MathJax.Hub.Queue(['Typeset', MathJax.Hub, ul]);
  }
}

// ============================================================================
// Organization & Entrepreneurship <details> — open/close in sync
// ============================================================================
function syncOrgEntreDetails() {
  const org = document.getElementById('details-organization');
  const ent = document.getElementById('details-entrepreneurship');
  if (!org || !ent) return;
  let lock = false;
  org.addEventListener('toggle', function () {
    if (lock) return;
    lock = true;
    ent.open = org.open;
    lock = false;
  });
  ent.addEventListener('toggle', function () {
    if (lock) return;
    lock = true;
    org.open = ent.open;
    lock = false;
  });
}

// ============================================================================
// Initialize from JSON data
// ============================================================================
document.addEventListener('DOMContentLoaded', function () {
  syncOrgEntreDetails();
  function fetchJsonSafe(url) {
    return fetch(url)
      .then(function (r) { return r.json(); })
      .catch(function (e) {
        console.error('Failed to load ' + url + ':', e);
        return null;
      });
  }

  Promise.all([
    fetchJsonSafe('content/timeline.json'),
    fetchJsonSafe('content/publications.json'),
    fetchJsonSafe('content/site-sections.json')
  ])
    .then(function (results) {
      window._cachedTimeline = results[0];
      window._cachedPublications = results[1];
      window._cachedSections = results[2];
      if (results[0]) initTimeline(results[0]);
      if (results[1]) {
        renderPublications(results[1]);
        renderNews(results[1]);
      }
      if (results[2]) renderSiteSections(results[2]);
      applyMode(false);
    });
});

// ============================================================================
// Global Event Listeners
// ============================================================================
window.onload = function () {
  var wechatModal = document.getElementById("WeChatModal");
  var awardModal = document.getElementById("AwardModal");
  if (wechatModal) wechatModal.style.display = "none";
  if (awardModal) awardModal.style.display = "none";

  var lastUpdateElement = document.getElementById("lastUpdateDate");
  if (lastUpdateElement) {
    var lastModified = new Date(document.lastModified);
    var options = { year: 'numeric', month: 'long', day: 'numeric' };
    lastUpdateElement.textContent = lastModified.toLocaleDateString('en-US', options);
  }
};

window.onclick = function (event) {
  var academicModal = document.getElementById("AcademicLinksModal");
  if (event.target == academicModal) academicModal.style.display = "none";

  var wechatModal = document.getElementById("WeChatModal");
  if (event.target == wechatModal) wechatModal.style.display = "none";

  var awardModal = document.getElementById("AwardModal");
  if (event.target == awardModal) awardModal.style.display = "none";
};

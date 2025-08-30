const KNOWN = ['qr','pdf417','aztec','code128'];
const clean = v => (v && KNOWN.includes(String(v).toLowerCase())) ? String(v).toLowerCase() : null;

function normalizeBarcodeSpec(input = {}) {
  const single = input.type || input.format || input.pref;
  const list   = Array.isArray(input.formats) ? input.formats : [];
  let primary  = input.primary || single || (list[0] || 'qr');
  let additional = input.additional || list.slice(1);

  primary = clean(primary) || 'qr';
  additional = (additional || []).map(clean).filter(Boolean);

  return {
    message: input.message || '{{cardCode}}',
    altText: input.altText || '{{cardCode}}',
    encoding: input.encoding || 'iso-8859-1',
    primary, additional
  };
}

function renderTpl(str, ctx) {
  return String(str ?? '').replace(/\{\{(\w+)\}\}/g, (_,k) => (ctx[k] ?? ''));
}

function resolveDesignForUser(designJson, ctx) {
  const d = JSON.parse(JSON.stringify(designJson || {}));
  d.defaults = d.defaults || {};
  if (!ctx.userName) ctx.userName = d.defaults.userName || 'Cliente';
  if (d.defaults.cardCodePrefix && ctx.cardCode && !ctx.cardCode.startsWith(d.defaults.cardCodePrefix)) {
    ctx.cardCode = d.defaults.cardCodePrefix + ctx.cardCode;
  }
  if (ctx.points == null && Number.isFinite(d.defaults.points)) ctx.points = d.defaults.points;

  const bc = normalizeBarcodeSpec(d.barcode || {});
  bc.message = renderTpl(bc.message, ctx);
  bc.altText = renderTpl(bc.altText, ctx);
  d.barcode = bc;
  return { design: d, ctx };
}

module.exports = { normalizeBarcodeSpec, resolveDesignForUser };

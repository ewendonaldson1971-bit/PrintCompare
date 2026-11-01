export const STATUS_LABELS = { pass: 'PASS', fail: 'FAIL', assessing: 'ASSESSING', not_assessed: 'NOT ASSESSED' };
export const ACCEPTANCE_RULES = 'PASS: slight size changes and minor colour shifts consistent with RGB-to-CMYK conversion. FAIL: missing or damaged logos, filled-in letter centres or other damaged lettering, significant colour changes, or other material artwork changes.';

export function reportStatus(report) {
  const a=report?.assessment;
  if(!a)return 'not_assessed';
  if(a.logos==='missing_or_damaged'||a.lettering==='filled_or_damaged'||a.colour==='significant_change'||a.content==='significant_change'||a.size==='significant_change')return 'fail';
  if(report.verdict==='inconclusive'||a.logos!=='intact'||a.lettering!=='intact'||a.colour!=='acceptable'||a.content!=='intact'||a.size!=='acceptable')return 'not_assessed';
  return 'pass';
}
export function pairStatus(result) {
  if(result.aiPending)return 'assessing';
  return result.error||!result.ai ? 'not_assessed' : reportStatus(result.ai.report);
}
export function overallStatus(results) {
  if(results.some(r=>pairStatus(r)==='assessing'))return 'assessing';
  if(results.some(r=>pairStatus(r)==='fail'))return 'fail';
  if(!results.length||results.some(r=>pairStatus(r)!=='pass'))return 'not_assessed';
  return 'pass';
}

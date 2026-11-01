import test from 'node:test';
import assert from 'node:assert/strict';
import {reportStatus,pairStatus,overallStatus} from '../dist/assessment.js';
import {reportLines} from '../dist/ai-report.js';
const acceptable={logos:'intact',lettering:'intact',colour:'acceptable',size:'acceptable',content:'intact'};
const report=assessment=>({verdict:'differences_found',assessment,decision_reason:'Assessed under artwork acceptance rules.',summary:'Visual check.',differences:[],shared_elements:[],checks:[],limitations:[]});
const result=assessment=>({ai:{report:report(assessment),model:'test',generatedAt:'2026-10-31'}});
test('acceptable size and colour-conversion changes pass even when pixels differ',()=>{
  assert.equal(reportStatus(report(acceptable)),'pass');
  assert.equal(pairStatus({...result(acceptable),percent:80,regions:[{pixels:100000}],ratioMismatch:true}),'pass');
});
test('a dropped logo or a significant colour change independently fails',()=>{
  assert.equal(reportStatus(report({...acceptable,logos:'missing_or_damaged'})),'fail');
  assert.equal(reportStatus(report({...acceptable,colour:'significant_change'})),'fail');
});
test('filled-in letter counters fail even when wording, colour and size otherwise match',()=>{
  assert.equal(reportStatus(report({...acceptable,lettering:'filled_or_damaged'})),'fail');
  assert.equal(reportStatus(report({...acceptable,lettering:'uncertain'})),'not_assessed');
  const oldReport=report({...acceptable});delete oldReport.assessment.lettering;assert.equal(reportStatus(oldReport),'not_assessed');
});
test('uncertainty or missing AI review never produces a pass',()=>{
  assert.equal(pairStatus({percent:0,regions:[]}),'not_assessed');
  assert.equal(pairStatus({aiError:'Timed out'}),'not_assessed');
  assert.equal(reportStatus(report({...acceptable,logos:'uncertain'})),'not_assessed');
  assert.equal(reportStatus({...report(acceptable),verdict:'inconclusive'}),'not_assessed');
});
test('active and queued reviews show Assessing rather than Not assessed or an old verdict',()=>{
  assert.equal(pairStatus({aiPending:true}),'assessing');
  assert.equal(pairStatus({...result(acceptable),aiPending:true}),'assessing');
  assert.equal(overallStatus([result(acceptable),{aiPending:true}]),'assessing');
  assert.equal(overallStatus([result({...acceptable,lettering:'filled_or_damaged'}),{aiPending:true}]),'assessing');
});
test('completed, cancelled and unsuccessful reviews leave the Assessing state',()=>{
  assert.equal(pairStatus({...result(acceptable),aiPending:false}),'pass');
  assert.equal(pairStatus({aiPending:false,aiError:'Cancelled'}),'not_assessed');
  assert.equal(overallStatus([result(acceptable),{aiPending:false,aiError:'Unavailable'}]),'not_assessed');
  assert.equal(overallStatus([result({...acceptable,lettering:'filled_or_damaged'}),{aiPending:false,aiError:'Cancelled'}]),'fail');
});
test('one failed proof fails the job; every proof must be assessed before an overall pass',()=>{
  assert.equal(overallStatus([result(acceptable),result({...acceptable,logos:'missing_or_damaged'})]),'fail');
  assert.equal(overallStatus([result(acceptable),{}]),'not_assessed');
  assert.equal(overallStatus([result(acceptable),result(acceptable)]),'pass');
  assert.equal(overallStatus([]),'not_assessed');
});
test('confirmed logo failure takes precedence over another uncertain criterion',()=>{
  assert.equal(reportStatus(report({...acceptable,logos:'missing_or_damaged',colour:'uncertain'})),'fail');
});
test('downloaded report carries the decision and acceptance rules',()=>{
  const output=reportLines(result(acceptable)).join('\n');
  assert.match(output,/STATUS: PASS/);assert.match(output,/RGB-to-CMYK/);assert.match(output,/Decision:/);
  assert.match(reportLines(result({...acceptable,colour:'significant_change'})).join('\n'),/STATUS: FAIL/);
});

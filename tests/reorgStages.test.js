import test from 'node:test';
import assert from 'node:assert/strict';
import {reorgRead,reorgCase} from '../server/specialSituations.js';

// Sentences from 8-Ks the reorg board misread in October 2026, trimmed to what dates the case
const GETY_PETITION='Item 1.03. Bankruptcy or Receivership. Voluntary Petitions for Reorganization As previously disclosed, on October 12, 2026, Getty Images Holdings, Inc. (the &#8220;Company&#8221;) and certain of its subsidiaries entered into a restructuring support agreement (the &#8220;RSA&#8221;) providing for a comprehensive recapitalization to be implemented through a prepackaged chapter 11 plan of reorganization, as described in the Company&#8217;s Current Report on Form 8-K filed on October 13, 2026. On October 21, 2026 (the &#8220;Petition Date&#8221;), the Company and certain of its subsidiaries filed voluntary petitions under chapter 11 of title 11 of the United States Code in the United States Bankruptcy Court for the District of Delaware to implement the Restructuring Transactions through a prepackaged chapter 11 plan of reorganization (the &#8220;Plan&#8221;). Under the Plan, all shares of the Company&#8217;s Class A common stock and all other existing equity interests in the Company will be cancelled, discharged, and extinguished on the effective date of the Plan, and holders will not receive or retain any distribution, recovery or property if the Plan is confirmed.';
const QVC_EMERGENCE='As previously disclosed, on April 16, 2026, Old QVC Group, Inc. (f/k/a QVC Group, Inc.) and certain of its affiliates filed voluntary petitions for relief under chapter 11 of title 11 of the United States Code. On July 20, 2026, the Bankruptcy Court entered an order confirming the Plan (the "Confirmation Order"), and on August 6, 2026 (the "Plan Effective Date"), the Plan became effective in accordance with its terms and the Company Parties emerged from bankruptcy. Pursuant to the Plan, on the Plan Effective Date, the Company issued approximately 21,430,005 shares of New Common Stock to the holders of allowed claims.';
const ZYNEX_CONFIRMATION='As previously reported, on December 15, 2025 (the "Petition Date"), Zynex, Inc. filed voluntary petitions under chapter 11. On March 19, 2026, the Court entered an order (the "Confirmation Order") confirming the Plan and approving the Disclosure Statement. The Company Parties currently expect that the Effective Date of the Plan will occur no later than March 31, 2026, although the Company Parties can make no assurances as to when, or ultimately if, the Plan will become effective.';
const QVC_MOR='Monthly Operating Report Chapter 11 Reporting Period Ended: 08/06/2026 Petition Date: 04/16/2026 Months Pending: 4. On August 6, 2026 (the "Plan Effective Date"), the Effective Date of the Plan occurred, and the Debtors became the Reorganized Debtors.';
const OPI_MOR='Petition Date: 10/30/2025. On April 21, 2026, the Debtors filed the Fourth Amended Joint Chapter 11 Plan of Reorganization. As of the date of this MOR, the effective date of the Plan has not yet occurred.';
const LESL_DIP='As previously reported, on September 30, 2026 (the "Petition Date"), Leslie’s, Inc. and its subsidiaries filed voluntary petitions under chapter 11. The ABL DIP Facility and the Term Loan DIP Facility each mature six months from October 2, 2026, subject to customary milestones and earlier maturity upon the effective date of the Plan (the "Plan Effective Date").';
const TRINSEO_PETITION='On May 26, 2026 (the "Petition Date"), the Debtors filed voluntary petitions under Chapter 11 of the Bankruptcy Code to implement the Plan and the transactions set forth therein and in the RSA. Holders of the Company’s Existing Equity Interests are expected to have their equity interests cancelled and will receive no recovery.';

const filing=(adsh,date,text,items=['1.03','9.01'],period=null)=>({adsh,date,period,items,t:reorgRead(text,date)});

test('a petition 8-K dates the petition only, however much of the plan it describes',()=>{
 const t=reorgRead(GETY_PETITION,'2026-10-21');
 assert.deepEqual(t.petition,['2026-10-21']); // not the October 12 support agreement under the "Voluntary Petitions" heading
 assert.deepEqual(t.confirmed,[]);assert.deepEqual(t.effective,[]);
 assert.ok(t.cancelled);assert.ok(t.prepack);assert.ok(t.planOnFile);
 const c=reorgCase({filings:[filing('0001213900-26-111193','2026-10-21',GETY_PETITION,['1.03','2.04','7.01','9.01'])],petitions:[{adsh:'0001213900-26-111193',date:'2026-10-21'}],today:'2026-10-22'});
 assert.equal(c.stage,'filed');assert.equal(c.petition,'2026-10-21');assert.equal(c.confirmed,null);assert.equal(c.emerged,null);assert.ok(c.cancelled);
});

test('confirmation and emergence are each dated by their own clause',()=>{
 const t=reorgRead(QVC_EMERGENCE,'2026-08-07');
 assert.deepEqual(t.petition,['2026-04-16']);assert.deepEqual(t.confirmed,['2026-07-20']);assert.deepEqual(t.effective,['2026-08-06']);
 assert.equal(t.newShares,'21,430,005');
 const c=reorgCase({filings:[filing('a','2026-08-07',QVC_EMERGENCE,['1.01','2.03','3.02','3.03','5.01','9.01'])],petitions:[{adsh:'b',date:'2026-07-24'}],today:'2026-10-22'});
 assert.equal(c.stage,'emerged');assert.equal(c.petition,'2026-04-16');assert.equal(c.emerged,'2026-08-06');assert.equal(c.emergedFiled,'2026-08-07');
});

test('an expected effective date is not an emergence',()=>{
 const t=reorgRead(ZYNEX_CONFIRMATION,'2026-03-20');
 assert.deepEqual(t.confirmed,['2026-03-19']);assert.deepEqual(t.effective,[]);assert.deepEqual(t.expected,['2026-03-31']);
 assert.equal(reorgCase({filings:[filing('a','2026-03-20',ZYNEX_CONFIRMATION)],today:'2026-03-25'}).stage,'effective date set');
 assert.equal(reorgCase({filings:[filing('a','2026-03-20',ZYNEX_CONFIRMATION)],today:'2026-04-02'}).stage,'plan confirmed');
});

test('monthly operating reports date what has happened and nothing that has not',()=>{
 const mor=reorgRead(QVC_MOR,'2026-09-22');
 assert.deepEqual(mor.petition,['2026-04-16']);assert.deepEqual(mor.effective,['2026-08-06']);
 const opi=reorgRead(OPI_MOR,'2026-06-04');
 assert.deepEqual(opi.petition,['2025-10-30']);assert.deepEqual(opi.effective,[]);assert.deepEqual(opi.confirmed,[]);
 // a DIP 8-K that mentions the effective date of the plan dates nothing either
 const dip=reorgRead(LESL_DIP,'2026-10-05');
 assert.deepEqual(dip.effective,[]);assert.deepEqual(dip.confirmed,[]);assert.deepEqual(dip.petition,['2026-09-30']);
});

test('May is a month, not a hedge',()=>{
 const t=reorgRead(TRINSEO_PETITION,'2026-05-26');
 assert.deepEqual(t.petition,['2026-05-26']);assert.ok(t.cancelled);
});

test('an emergence must follow the petition and not precede the confirmation',()=>{
 const said=(effective,confirmed=[])=>({petition:[],confirmed,effective,effectiveToday:false,expected:[],ch11:true});
 const rows=[{adsh:'p',date:'2026-10-21',items:['1.03'],t:{...said([]),petition:['2026-10-21'],planOnFile:true}},{adsh:'e',date:'2026-10-21',items:['1.03'],t:said(['2026-10-21'])}];
 assert.equal(reorgCase({filings:rows,today:'2026-10-22'}).emerged,null); // same day as the petition
 assert.equal(reorgCase({filings:[...rows.slice(0,1),{adsh:'e',date:'2026-11-03',items:['1.03'],t:said(['2026-10-30'],['2026-11-02'])}],today:'2026-11-05'}).emerged,null); // before its confirmation
 const ok=reorgCase({filings:[...rows.slice(0,1),{adsh:'e',date:'2026-11-03',items:['1.03'],t:said(['2026-11-02'],['2026-10-30'])}],today:'2026-11-05'});
 assert.equal(ok.stage,'emerged');assert.equal(ok.emerged,'2026-11-02');
});

test('Item 5.01 or 3.03 with new shares reads as the emergence, dated by the event, never on a petition 8-K',()=>{
 const t={petition:['2026-02-01'],confirmed:[],effective:[],effectiveToday:false,expected:[],ch11:true,newEquity:true};
 const c=reorgCase({filings:[{adsh:'x',date:'2026-03-10',period:'2026-03-05',items:['1.01','1.03','3.02','3.03','5.01','5.02'],t}],today:'2026-04-01'});
 assert.equal(c.stage,'emerged');assert.equal(c.emerged,'2026-03-05');
 const petition=reorgCase({filings:[{adsh:'x',date:'2026-02-02',period:'2026-02-01',items:['1.03','2.04','3.03','5.01'],t:{...t,planOnFile:true}}],today:'2026-04-01'});
 assert.equal(petition.emerged,null);assert.equal(petition.stage,'filed');
});

test('an Item 1.03 8-K that reports the emergence is not taken for the petition',()=>{
 // the bankruptcy tab's list held only the emergence 8-K; the petition itself was older than its window
 const t={petition:[],confirmed:['2026-04-15'],effective:['2026-10-16'],effectiveToday:false,expected:[],ch11:true};
 const c=reorgCase({filings:[{adsh:'em',date:'2026-10-16',items:['1.03','3.02','3.03','5.01'],t}],petitions:[{adsh:'em',date:'2026-10-16'}],today:'2026-10-22'});
 assert.equal(c.petition,null);assert.equal(c.stage,'emerged');assert.equal(c.emerged,'2026-10-16');
});

test('a case with only a petition and no plan on file stays off the board',()=>{
 const t={petition:['2026-03-30'],confirmed:[],effective:[],effectiveToday:false,expected:[],ch11:true,planOnFile:null};
 assert.equal(reorgCase({filings:[{adsh:'s',date:'2026-07-15',items:['1.03','9.01'],t}],today:'2026-10-22'}).stage,null);
});

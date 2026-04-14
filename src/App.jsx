import { useState } from "react";

// ── CONSTANTS ─────────────────────────────────────────────────────────────
const TRUCK_TYPES = ["High Roof Cargo Van","15 Cube","16 Cabover","26 FT CDL","26 FT G Class","18 Reefer","26 CDL Reefer","26 G Class Reefer","Day Cab","Sleeper"];

const LINE = {
  RL:  { bg:"#84cc16", text:"#1a2e05", label:"Ready Line" },
  WL:  { bg:"#7dd3fc", text:"#0c2a3e", label:"Wash Line" },
  SRL: { bg:"#f1f5f9", text:"#0f172a", label:"Service Ready" },
  SL:  { bg:"#f87171", text:"#3b0a0a", label:"Service Line" },
  SHOP:{ bg:"#e8b4bc", text:"#f9fafb", label:"Shop / Deadline" },
  PUR: { bg:"#a855f7", text:"#f5f3ff", label:"Purolator" },
};

// ── HELPERS ───────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2,9);
const todayStr = () => new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
const todayKey = () => new Date().toISOString().slice(0,10);
const fmtDate  = d => { if(!d) return ""; return new Date(d+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}); };
const fmtKey   = k => { if(!k) return ""; return new Date(k+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}); };
const twoWeeks = () => { const d=new Date(); d.setDate(d.getDate()+14); return d.toISOString().slice(0,10); };
const daysUntil = d => {
  if(!d) return null;
  const t=new Date(); t.setHours(0,0,0,0);
  return Math.round((new Date(d+"T00:00:00")-t)/(864e5));
};

const mkBoard = () => { const b={}; TRUCK_TYPES.forEach(t=>{b[t]=[];}); return b; };
const BLANK = () => ({ yard:mkBoard(), reso:mkBoard(), tomorrow:mkBoard(), pm:[], tasks:[], hikes:[], sent:[], checkins:[], pmScheduled:[], pmRows:[], pmInitialized:false, groundSwaps:[], groundNeeds:[], puroFleetRows:[], puroFleetOriginal:null, puroOrigBytes:null, puroRemovedUnits:[] });
// pmRows: PM checklist — starts empty, filled via upload or yard PM button
// pmInitialized: true once user has uploaded or added PM rows (prevents re-seeding)
// pmScheduled: [{unit,scheduledDate,swapRequired,swapUnit,customer}] for task generation

// ── PM DATA FROM EXCEL ────────────────────────────────────────────────────
// Parsed from uploaded PM schedule table (Belfield location)
const PM_DATA_RAW = [
  { unit:"515857", pmType:"DRY", customer:"FORTIGO FREIGHT SERVICES INC",  nextPM:"2026-03-18", daysLeft:-14, defeDays:"Orange", comment:"4th" },
  { unit:"568080", pmType:"WET", customer:"PUROLATOR INC",                  nextPM:"2026-03-21", daysLeft:-11, defeDays:"Yellow", comment:"Done" },
  { unit:"516557", pmType:"DRY", customer:"THOMSON TERMINALS LTD",          nextPM:"2026-03-21", daysLeft:-11, defeDays:"Yellow", comment:"7th" },
  { unit:"567278", pmType:"DRY", customer:"PUROLATOR INC",                  nextPM:"2026-03-25", daysLeft:-7,  defeDays:"Yellow", comment:"14th" },
  { unit:"198385", pmType:"DRY", customer:"SURE TRACK COURIER LTD",         nextPM:"2026-03-29", daysLeft:-3,  defeDays:"Gray",   comment:"" },
  { unit:"292019", pmType:"WET", customer:"FORTIGO FREIGHT SERVICES INC",   nextPM:"2026-04-11", daysLeft:10,  defeDays:"8:14 Days", comment:"17th" },
  { unit:"235651", pmType:"DRY", customer:"THOMSON TERMINALS INC",          nextPM:"2026-04-12", daysLeft:11,  defeDays:"8:14 Days", comment:"15th" },
  { unit:"569763", pmType:"DRY", customer:"PUROLATOR INC",                  nextPM:"2026-04-14", daysLeft:13,  defeDays:"8:14 Days", comment:"21st" },
  { unit:"284007", pmType:"DRY", customer:"ATS HEALTHCARE INC",             nextPM:"2026-04-14", daysLeft:13,  defeDays:"8:14 Days", comment:"22nd" },
  { unit:"228643", pmType:"G1",  customer:"KNG INC",                        nextPM:"2026-04-18", daysLeft:17,  defeDays:"15:30 Days", comment:"" },
  { unit:"516561", pmType:"DRY", customer:"THOMSON TERMINALS LTD",          nextPM:"2026-04-19", daysLeft:18,  defeDays:"15:30 Days", comment:"24th" },
];

function urgencyColor(days){
  if(days < 0)  return { bg:"#7f1d1d", text:"#fca5a5", label:"OVERDUE" };
  if(days <= 5)  return { bg:"#78350f", text:"#fdba74", label:"URGENT" };
  if(days <= 14) return { bg:"#713f12", text:"#fde68a", label:"SOON" };
  return { bg:"#f3c0c8", text:"#6b4c52", label:"UPCOMING" };
}

// ── PM TAB COMPONENT ──────────────────────────────────────────────────────
// PM rows live in main state (S.pmRows) — starts EMPTY, populated via Excel upload or yard PM button
function PMTab({ S, setS, notify, openModal }) {

  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("days");
  const [expandedId, setExpandedId] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);

  const rows = S.pmRows || [];
  const allYardUnits = Object.values(S.yard||{}).flat();
  function isUnitOnYard(unit){ return allYardUnits.some(u=>String(u.unit).trim()===String(unit).trim()); }

  // Parse CSV text into PM row objects — robust quoted CSV handling
  function parseCSVtoPMRows(csv){
    // Split CSV properly handling quoted fields
    function splitCSVLine(line){
      const result=[]; let cur=""; let inQ=false;
      for(let i=0;i<line.length;i++){
        if(line[i]==='"'){ inQ=!inQ; }
        else if(line[i]===','&&!inQ){ result.push(cur.trim()); cur=""; }
        else { cur+=line[i]; }
      }
      result.push(cur.trim());
      return result.map(v=>v.replace(/^"|"$/g,'').trim());
    }
    const lines = csv.split(/\r?\n/).filter(l=>l.trim());
    if(lines.length < 2) throw new Error("File appears empty or has no data rows");
    const headers = splitCSVLine(lines[0]).map(h=>h.toLowerCase().replace(/[^a-z0-9 ]/g,''));
    const get = (row,...keys) => {
      for(const k of keys){
        const idx=headers.findIndex(h=>h.includes(k));
        if(idx>=0&&row[idx]!=null&&row[idx]!=='') return row[idx];
      }
      return "";
    };
    const parsed=[];
    for(let i=1;i<lines.length;i++){
      const row=splitCSVLine(lines[i]);
      if(row.every(c=>!c)) continue;
      const unit=get(row,'unit');
      if(!unit||unit.length<3||isNaN(Number(unit.replace(/\D/g,'')))) continue;
      const pmType  =get(row,'pm type','type','pm')||"";
      const customer=get(row,'customer','cust');
      const nextPM  =get(row,'next pm','due','pm due','date');
      const daysLeft=parseInt(get(row,'days until','days left','days'))||0;
      const defeDays=get(row,'defe','deferral');
      const comment =get(row,'comment','comments','note','pm #');
      const location=get(row,'location','loc','branch','site')||"";
      parsed.push({unit,pmType,customer,nextPM,daysLeft,defeDays,comment,location});
    }
    if(parsed.length===0) throw new Error("No valid unit rows found — check your column headers include 'Unit'");
    return parsed;
  }

  // Merge parsed rows into pmRows — skip duplicates by unit #, preserve existing status/scheduledDate
  function mergePMRows(parsed){
    setS(s=>{
      const existing = s.pmRows || [];
      const existingUnits = new Set(existing.map(r=>r.unit));
      let added = 0, dupes = 0;
      const newRows = [...existing];
      for(const r of parsed){
        if(existingUnits.has(r.unit)){ dupes++; continue; }
        newRows.push({
          ...r, id:uid(), status:"pending", scheduledDate:"",
          swapRequired:false, swapUnit:"", notes:r.comment||"",
          location:r.location||"", locationNotified:false, _prev:null,
        });
        existingUnits.add(r.unit);
        added++;
      }
      // Deduplicate existing rows too — keep first occurrence
      const seen = new Set();
      const deduped = newRows.filter(r=>{ if(seen.has(r.unit)) return false; seen.add(r.unit); return true; });
      setUploadStatus({ok:true, msg:`✓ Imported ${added} new unit${added!==1?"s":""} · ${dupes} duplicate${dupes!==1?"s":""} skipped · ${deduped.length} total`});
      return {...s, pmRows:deduped, pmInitialized:true};
    });
  }

  function updateRow(id, patch){
    // If swapRequired is being turned ON, auto-increment ground needs for this unit's truck type
    if(patch.swapRequired===true){
      const row = (S.pmRows||[]).find(r=>r.id===id);
      if(row){
        setS(s=>{
          const tt = row.pmType||""; // use pmType as truck type hint, or skip if blank
          const updated = s.pmRows.map(r=>r.id===id?{...r,...patch}:r);
          // Find truck type from yard if available
          const yardUnit = Object.entries(s.yard||{}).find(([tt2,cards])=>cards.some(c=>String(c.unit)===String(row.unit)));
          const truckType = yardUnit ? yardUnit[0] : "";
          if(!truckType) return {...s, pmRows:updated};
          const existingNeeds = s.groundNeeds||[];
          const exists = existingNeeds.find(n=>n.tt===truckType);
          const newNeeds = exists
            ? existingNeeds.map(n=>n.tt===truckType?{...n,count:n.count+1}:n)
            : [...existingNeeds,{tt:truckType,count:1}];
          return {...s, pmRows:updated, groundNeeds:newNeeds};
        });
        return;
      }
    }
    // If swapRequired turned OFF, decrement
    if(patch.swapRequired===false){
      const row = (S.pmRows||[]).find(r=>r.id===id);
      if(row && row.swapRequired){
        setS(s=>{
          const updated = s.pmRows.map(r=>r.id===id?{...r,...patch}:r);
          const yardUnit = Object.entries(s.yard||{}).find(([tt2,cards])=>cards.some(c=>String(c.unit)===String(row.unit)));
          const truckType = yardUnit ? yardUnit[0] : "";
          if(!truckType) return {...s, pmRows:updated};
          const newNeeds = (s.groundNeeds||[])
            .map(n=>n.tt===truckType?{...n,count:Math.max(0,n.count-1)}:n)
            .filter(n=>n.count>0);
          return {...s, pmRows:updated, groundNeeds:newNeeds};
        });
        return;
      }
    }
    setS(s=>({...s, pmRows:s.pmRows.map(r=>r.id===id?{...r,...patch}:r)}));
  }

  function updateWithUndo(id, patch){
    setS(s=>({...s, pmRows:s.pmRows.map(r=>r.id===id?{...r,_prev:{status:r.status,scheduledDate:r.scheduledDate},...patch}:r)}));
  }

  function undoRow(id){
    setS(s=>({...s, pmRows:s.pmRows.map(r=>{
      if(r.id!==id||!r._prev) return r;
      return {...r,...r._prev,_prev:null};
    })}));
    notify("Action undone ↩");
  }

  function markScheduled(id, scheduledDate){
    if(!scheduledDate){ notify("Please pick a scheduled date first"); return; }
    const row = rows.find(r=>r.id===id);
    if(!row) return;
    updateWithUndo(id, { status:"scheduled", scheduledDate });
    // Sync to pmScheduled for newDay task generation
    setS(s=>{
      const existing=(s.pmScheduled||[]).filter(p=>p.unit!==row.unit);
      return {...s, pmScheduled:[...existing,{unit:row.unit,scheduledDate,swapRequired:row.swapRequired,swapUnit:row.swapUnit,customer:row.customer,pmType:row.pmType}]};
    });
    notify(`Unit ${row.unit} scheduled for ${fmtDate(scheduledDate)} ✓`);
  }

  function markDone(id){
    const row = rows.find(r=>r.id===id);
    // Mark done — will be filtered out on next New Day, stays visible today
    updateWithUndo(id, { status:"done" });
    // Remove from pmScheduled so it doesn't generate tasks anymore
    setS(s=>({...s, pmScheduled:(s.pmScheduled||[]).filter(p=>p.unit!==row?.unit)}));
    if(row) notify(`Unit ${row.unit} PM done ✓ — will be removed on next New Day`);
  }


  const filtered = rows
    .filter(r => filterStatus==="all" || r.status===filterStatus)
    .sort((a,b) => sortBy==="days" ? a.daysLeft-b.daysLeft : a.unit.localeCompare(b.unit));

  const overdue   = rows.filter(r=>r.daysLeft<0&&r.status!=="done").length;
  const urgent    = rows.filter(r=>r.daysLeft>=0&&r.daysLeft<=5&&r.status!=="done").length;
  const scheduled = rows.filter(r=>r.status==="scheduled").length;
  const done      = rows.filter(r=>r.status==="done").length;

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:16}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#fb923c",letterSpacing:"0.08em"}}>PM SCHEDULE</div>
          <div style={{fontSize:10,color:"#9c6b75",marginTop:1}}>Imported from Belfield PM table · set scheduled date · confirm done · undo any action</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[["OVERDUE",overdue,"#ef4444","#7f1d1d"],["URGENT",urgent,"#fb923c","#78350f"],["SCHEDULED",scheduled,"#34d399","#064e3b"],["DONE",done,"#a07880","#f3c0c8"]].map(([l,v,c,bg])=>(
            <div key={l} style={{background:bg,border:`1px solid ${c}33`,borderRadius:6,padding:"4px 12px",textAlign:"center"}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:c}}>{v}</div>
              <div style={{fontSize:9,color:c,opacity:0.8,letterSpacing:"0.06em"}}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter + Sort */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em"}}>Filter:</span>
        {[["all","All"],["pending","Pending"],["scheduled","Scheduled"],["done","Done"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilterStatus(v)} style={{border:"none",borderRadius:5,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:filterStatus===v?"#f59e0b":"#f3c0c8",color:filterStatus===v?"#fdf2f4":"#a07880"}}>{l}</button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em"}}>Sort:</span>
          {[["days","By Date"],["unit","By Unit"]].map(([v,l])=>(
            <button key={v} onClick={()=>setSortBy(v)} style={{border:"none",borderRadius:5,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:sortBy===v?"#e8b4bc":"#f3c0c8",color:sortBy===v?"#1a1a2e":"#a07880"}}>{l}</button>
          ))}
        </div>
      </div>

      {/* Checklist */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.map(row=>{
          const urg=urgencyColor(row.daysLeft);
          const isDone=row.status==="done";
          const isScheduled=row.status==="scheduled";
          const expanded=expandedId===row.id;
          const canUndo=!!row._prev;
          return (
            <div key={row.id} style={{background:"#ffffff",border:`1px solid ${isDone?"#f3c0c8":isScheduled?"#16a34a44":urg.bg}`,borderRadius:9,overflow:"hidden",opacity:isDone?0.6:1,transition:"all 0.2s"}}>

              {/* ── MAIN ROW ── */}
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",cursor:"pointer",flexWrap:"wrap"}} onClick={()=>setExpandedId(expanded?null:row.id)}>

                {/* Status dot */}
                <div style={{width:10,height:10,borderRadius:"50%",background:isDone?"#4ade80":isScheduled?"#34d399":urg.bg,flexShrink:0,boxShadow:isScheduled?"0 0 6px #16a34a":undefined}}/>

                {/* Unit */}
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:isDone?"#e8b4bc":isScheduled?"#34d399":urg.text,minWidth:65,textDecoration:isDone?"line-through":undefined}}>{row.unit}</div>

                {/* PM type */}
                <div style={{background:"#f3c0c8",color:"#7a5560",borderRadius:4,padding:"1px 7px",fontSize:10,fontWeight:600,flexShrink:0}}>{row.pmType}</div>

                {/* ON YARD badge */}
                {isUnitOnYard(row.unit)&&!isDone&&(
                  <div style={{background:"#dcfce7",border:"1px solid #16a34a",borderRadius:4,padding:"1px 7px",fontSize:9,fontWeight:700,color:"#15803d",flexShrink:0}}>🟢 ON YARD</div>
                )}

                {/* Swap required badge */}
                {row.swapRequired&&!isDone&&(
                  <div style={{background:"#fff7ed",border:"1px solid #f97316",borderRadius:4,padding:"1px 7px",fontSize:9,fontWeight:700,color:"#c2410c",flexShrink:0}}>🔄 SWAP{row.swapUnit?" #"+row.swapUnit:""}</div>
                )}

                {/* Non-Belfield location badge */}
                {row.location&&row.location.toLowerCase().indexOf("belfield")===-1&&!isDone&&(
                  <div style={{background:"#fefce8",border:"1px solid #ca8a04",borderRadius:4,padding:"1px 7px",fontSize:9,fontWeight:700,color:"#92400e",flexShrink:0}}>
                    📍 {row.location}{row.locationNotified?" · Notified":""}
                  </div>
                )}

                {/* Customer */}
                <div style={{flex:1,fontSize:11,color:isDone?"#e8b4bc":"#a07880",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:80}}>{row.customer}</div>

                {/* Days / status pill */}
                <div style={{background:isDone?"#f3c0c8":isScheduled?"#064e3b":urg.bg,color:isDone?"#4ade80":isScheduled?"#34d399":urg.text,borderRadius:5,padding:"2px 10px",fontSize:11,fontWeight:700,flexShrink:0,minWidth:88,textAlign:"center"}}>
                  {isDone?"✓ DONE":isScheduled?`📅 ${fmtDate(row.scheduledDate)}`:row.daysLeft<0?`${Math.abs(row.daysLeft)}d overdue`:row.daysLeft===0?"DUE TODAY":`${row.daysLeft}d left`}
                </div>

                {/* Next PM date */}
                <div style={{fontSize:10,color:"#e8b4bc",flexShrink:0,minWidth:55}}>{fmtDate(row.nextPM)}</div>

                {/* Action buttons */}
                <div style={{display:"flex",gap:5,flexShrink:0,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
                  {canUndo&&(
                    <button onClick={()=>undoRow(row.id)} style={{background:"#f3c0c8",border:"1px solid #374151",color:"#6b4c52",borderRadius:5,padding:"4px 8px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}} title="Undo last action">
                      ↩ Undo
                    </button>
                  )}
                  {!isDone&&!isScheduled&&(
                    <button onClick={()=>markDone(row.id)} style={{background:"#dcfce7",border:"1px solid #16a34a",color:"#4ade80",borderRadius:5,padding:"4px 9px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                      ✓ Done
                    </button>
                  )}
                  {isDone&&(
                    <span style={{fontSize:10,color:"#4ade80",fontWeight:700}}>✅ Complete</span>
                  )}
                  {/* Delete button */}
                  <button
                    onClick={()=>setS(s=>({...s,pmRows:s.pmRows.filter(r=>r.id!==row.id),pmScheduled:(s.pmScheduled||[]).filter(p=>p.unit!==row.unit),pmInitialized:true}))}
                    style={{background:"transparent",border:"1px solid #374151",color:"#9c6b75",borderRadius:5,padding:"4px 7px",fontSize:11,fontWeight:700,cursor:"pointer",lineHeight:1}}
                    title="Delete this PM row">
                    ✕
                  </button>
                </div>

                <div style={{fontSize:10,color:"#e8b4bc",flexShrink:0}}>{expanded?"▲":"▼"}</div>
              </div>

              {/* ── EXPANDED PANEL ── */}
              {expanded&&(
                <div style={{borderTop:"1px solid #1f2937",padding:"14px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>

                  {/* Left: details */}
                  <div>
                    <div style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Details</div>
                    <div style={{fontSize:12,color:"#7a5560",lineHeight:2}}>
                      <div><span style={{color:"#9c6b75"}}>Customer: </span><span style={{color:"#6b4c52"}}>{row.customer}</span></div>
                      <div><span style={{color:"#9c6b75"}}>PM Type: </span><span style={{color:"#6b4c52"}}>{row.pmType}</span></div>
                      <div><span style={{color:"#9c6b75"}}>Due Date: </span><span style={{color:"#f59e0b"}}>{fmtDate(row.nextPM)}</span></div>
                      <div><span style={{color:"#9c6b75"}}>Deferral: </span><span style={{color:"#6b4c52"}}>{row.defeDays}</span></div>
                      {row.comment&&<div><span style={{color:"#9c6b75"}}>PM #: </span><span style={{color:"#6b4c52"}}>{row.comment}</span></div>}
                      {row.scheduledDate&&<div><span style={{color:"#9c6b75"}}>Scheduled: </span><span style={{color:"#34d399",fontWeight:700}}>{fmtDate(row.scheduledDate)}</span></div>}
                    </div>

                    {/* ON YARD banner */}
                    {isUnitOnYard(row.unit)&&!isDone&&(
                      <div style={{marginTop:8,background:"#dcfce7",border:"2px solid #16a34a",borderRadius:7,padding:"8px 12px"}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#15803d"}}>🟢 This unit is currently ON YOUR YARD</div>
                        <div style={{fontSize:10,color:"#166534",marginTop:2}}>You can schedule the PM while it is here</div>
                      </div>
                    )}

                    {/* Non-Belfield location panel */}
                    {row.location&&row.location.toLowerCase().indexOf("belfield")===-1&&!isDone&&(
                      <div style={{marginTop:8,background:"#fefce8",border:"2px solid #ca8a04",borderRadius:7,padding:"10px"}}>
                        <div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:6}}>📍 Unit at {row.location} — not at Belfield</div>
                        {!row.locationNotified?(
                          <button onClick={()=>updateWithUndo(row.id,{locationNotified:true,status:"scheduled",scheduledDate:row.scheduledDate||""})}
                            style={{width:"100%",background:"#fef08a",border:"1px solid #ca8a04",color:"#713f12",borderRadius:5,padding:"6px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                            📞 Mark Location Notified → Move to Scheduled
                          </button>
                        ):(
                          <div>
                            <div style={{fontSize:10,color:"#15803d",fontWeight:700,marginBottom:6}}>✅ Location notified — waiting for drop-off date</div>
                            <input type="date" value={row.scheduledDate||""} onChange={e=>updateRow(row.id,{scheduledDate:e.target.value})}
                              style={{width:"100%",background:"#fff",border:"1px solid #ca8a04",color:"#1a1a2e",borderRadius:5,padding:"6px 10px",fontFamily:"inherit",fontSize:12,outline:"none",marginBottom:6}}/>
                            {row.scheduledDate&&<div style={{fontSize:10,color:"#92400e"}}>PM date set: {fmtDate(row.scheduledDate)}</div>}
                            <button onClick={()=>updateRow(row.id,{locationNotified:false})}
                              style={{marginTop:6,background:"transparent",border:"1px solid #f3c0c8",color:"#9c6b75",borderRadius:5,padding:"4px 8px",fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>
                              ↩ Undo Notified
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <div style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:2}}>Actions</div>

                    {/* Schedule date picker + confirm */}
                    {!isDone&&(
                      <div style={{background:"#f3c0c8",borderRadius:7,padding:"10px"}}>
                        <div style={{fontSize:10,color:"#7a5560",marginBottom:5}}>📅 Schedule PM for date:</div>
                        <input
                          type="date"
                          value={row.scheduledDate||""}
                          onChange={e=>updateRow(row.id,{scheduledDate:e.target.value})}
                          style={{background:"#ffffff",border:"1px solid #374151",color:"#1a1a2e",borderRadius:5,padding:"6px 10px",fontFamily:"inherit",fontSize:12,width:"100%",outline:"none",marginBottom:6}}
                        />
                        <button
                          onClick={()=>markScheduled(row.id, row.scheduledDate)}
                          style={{width:"100%",background:isScheduled?"#064e3b":"#1e3a5f",border:`1px solid ${isScheduled?"#16a34a":"#2d5080"}`,color:isScheduled?"#4ade80":"#93c5fd",borderRadius:5,padding:"6px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                          {isScheduled?"✓ Scheduled — update date":"📧 Mark Scheduled + Email Sent"}
                        </button>
                      </div>
                    )}

                    {/* Swap required */}
                    <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",background:row.swapRequired?"#fff7ed":"#f9fafb",border:"1px solid "+(row.swapRequired?"#f97316":"#f3c0c8"),borderRadius:6,padding:"8px 10px"}}>
                      <input type="checkbox" checked={!!row.swapRequired} onChange={e=>updateRow(row.id,{swapRequired:e.target.checked})} style={{width:14,height:14,accentColor:"#f97316",cursor:"pointer"}}/>
                      <div>
                        <div style={{fontSize:12,color:row.swapRequired?"#c2410c":"#a07880",fontWeight:row.swapRequired?"700":"400"}}>🔄 Swap Required</div>
                        {row.swapRequired&&<div style={{fontSize:9,color:"#92400e",marginTop:1}}>A swap unit must be on yard before this PM can be done</div>}
                      </div>
                    </label>
                    {row.swapRequired&&(
                      <div>
                        <input placeholder="Assign swap unit # (links to Ground Units tab)..." value={row.swapUnit||""} onChange={e=>updateRow(row.id,{swapUnit:e.target.value})}
                          style={{background:"#fff",border:"1px solid #f97316",borderRadius:5,padding:"6px 10px",fontFamily:"inherit",fontSize:12,color:"#1a1a2e",outline:"none",width:"100%"}}/>
                        {row.swapUnit&&(
                          <div style={{fontSize:10,color:"#c2410c",marginTop:4,padding:"4px 8px",background:"#fff7ed",borderRadius:4}}>
                            Swap unit #{row.swapUnit} assigned — check Ground Units tab to track availability
                          </div>
                        )}
                      </div>
                    )}



                    {/* Mark done from expanded */}
                    {!isDone&&(
                      <button onClick={()=>markDone(row.id)} style={{background:"#dcfce7",border:"1px solid #16a34a",color:"#4ade80",borderRadius:5,padding:"6px 10px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                        ✅ Confirm PM Done
                      </button>
                    )}

                    {/* Undo from expanded */}
                    {canUndo&&(
                      <button onClick={()=>undoRow(row.id)} style={{background:"#f3c0c8",border:"1px solid #374151",color:"#6b4c52",borderRadius:5,padding:"6px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                        ↩ Undo Last Action
                      </button>
                    )}

                    {/* Notes */}
                    <textarea placeholder="Notes..." value={row.notes} onChange={e=>updateRow(row.id,{notes:e.target.value})}
                      style={{background:"#f3c0c8",border:"1px solid #374151",borderRadius:5,padding:"7px 10px",fontFamily:"inherit",fontSize:11,color:"#6b4c52",outline:"none",width:"100%",resize:"vertical",minHeight:56}}/>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── UPLOAD SECTION ── */}
      <div style={{marginTop:20,background:"#ffffff",border:"1px solid #f3c0c8",borderRadius:10,padding:"16px"}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:"#fb923c",letterSpacing:"0.06em",marginBottom:4}}>UPLOAD NEW PM TABLE</div>
        <div style={{fontSize:10,color:"#9c6b75",marginBottom:12}}>Upload an Excel (.xlsx), CSV (.csv), or screenshot image — new units are merged in, duplicates are ignored, existing statuses are preserved</div>

        {/* File drop zone */}
        <label style={{display:"block",border:"2px dashed #374151",borderRadius:8,padding:"20px",textAlign:"center",cursor:"pointer",transition:"border-color 0.15s",background:"#fdf2f4"}}
          onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="#f59e0b";}}
          onDragLeave={e=>{e.currentTarget.style.borderColor="#e8b4bc";}}
          onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="#e8b4bc";handlePMUpload(e.dataTransfer.files[0]);}}>
          <input type="file" accept=".xlsx,.xls,.csv,.png,.jpg,.jpeg" style={{display:"none"}} onChange={e=>handlePMUpload(e.target.files[0])}/>
          <div style={{fontSize:24,marginBottom:6}}>📎</div>
          <div style={{fontSize:12,color:"#7a5560"}}>Drop file here or tap to browse</div>
          <div style={{fontSize:10,color:"#e8b4bc",marginTop:3}}>Excel · CSV · Screenshot image</div>
        </label>

        {uploadStatus&&(
          <div style={{marginTop:10,padding:"8px 12px",background:uploadStatus.ok?"#052e16":"#450a0a",border:`1px solid ${uploadStatus.ok?"#16a34a":"#ef4444"}`,borderRadius:6,fontSize:11,color:uploadStatus.ok?"#4ade80":"#fca5a5"}}>
            {uploadStatus.msg}
          </div>
        )}
      </div>
    </div>
  );

  // ── UPLOAD HANDLER ── defined inside PMTab scope so it can access state
  function handlePMUpload(file){
    if(!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    setUploadStatus({ok:true,msg:"Reading file..."});

    if(ext==="csv"){
      const reader = new FileReader();
      reader.onload = e => {
        try { mergePMRows(parseCSVtoPMRows(e.target.result)); }
        catch(err){ setUploadStatus({ok:false,msg:"CSV error: "+err.message}); }
      };
      reader.onerror = ()=>setUploadStatus({ok:false,msg:"Could not read file"});
      reader.readAsText(file);

    } else if(ext==="xlsx"||ext==="xls"){
      // Load SheetJS dynamically then parse
      const script = document.createElement('script');
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      script.onload = () => {
        const reader = new FileReader();
        reader.onload = e => {
          try {
            const wb = window.XLSX.read(new Uint8Array(e.target.result), {type:"array"});
            const ws = wb.Sheets[wb.SheetNames[0]];
            const csv = window.XLSX.utils.sheet_to_csv(ws);
            mergePMRows(parseCSVtoPMRows(csv));
          } catch(err){ setUploadStatus({ok:false,msg:"Excel error: "+err.message}); }
        };
        reader.readAsArrayBuffer(file);
      };
      script.onerror = ()=>setUploadStatus({ok:false,msg:"Could not load Excel parser. Please save your file as CSV from Excel (File → Save As → CSV) and upload that instead."});
      document.head.appendChild(script);

    } else if(["png","jpg","jpeg"].includes(ext)){
      setUploadStatus({ok:false,msg:"📸 Image detected — to import from a screenshot: open the image, manually note the unit numbers, then add them via the yard PM button (🔧 PM on each card). For auto-import, export your Excel as CSV (File → Save As → CSV) and upload that."});

    } else {
      setUploadStatus({ok:false,msg:"Please upload an Excel (.xlsx) or CSV (.csv) file"});
    }
  }
}

// ── GROUND UNITS TAB ─────────────────────────────────────────────────────
function GroundUnitsTab({ S, setS, notify, TRUCK_TYPES }) {
  const [swaps, setSwaps_]   = useState(S.groundSwaps||[]);
  const [needs, setNeeds_]   = useState(S.groundNeeds||[]); // [{tt, count}]
  const [addSwapForm, setAddSwapForm] = useState(null); // {currentUnit:"",tt:"",pendingUnit:""}
  const [needForm, setNeedForm]       = useState({tt:"",count:""});

  function setSwaps(fn){ const n=typeof fn==="function"?fn(swaps):fn; setSwaps_(n); setS(s=>({...s,groundSwaps:n})); }
  function setNeeds(fn){ const n=typeof fn==="function"?fn(needs):fn; setNeeds_(n); setS(s=>({...s,groundNeeds:n})); }

  function addSwap(){
    if(!addSwapForm?.currentUnit?.trim()||!addSwapForm?.tt) return;
    const tt = addSwapForm.tt;
    setSwaps(prev=>[...prev,{id:uid(),currentUnit:addSwapForm.currentUnit.trim(),tt:tt,pendingUnit:addSwapForm.pendingUnit?.trim()||""}]);
    // Auto-increment the Units Needed counter for this truck type
    setNeeds(prev=>{
      const exists = prev.find(n=>n.tt===tt);
      if(exists) return prev.map(n=>n.tt===tt?{...n,count:n.count+1}:n);
      return [...prev,{tt:tt,count:1}];
    });
    setAddSwapForm(null);
    notify("Swap added ✓ — Units Needed counter updated");
  }

  function updatePending(id, val){
    setSwaps(prev=>prev.map(s=>s.id===id?{...s,pendingUnit:val}:s));
  }

  function removeSwap(id){
    const swap = swaps.find(s=>s.id===id);
    setSwaps(prev=>prev.filter(s=>s.id!==id));
    // Decrement the counter for this truck type (min 0)
    if(swap){
      setNeeds(prev=>prev.map(n=>n.tt===swap.tt?{...n,count:Math.max(0,n.count-1)}:n)
        .filter(n=>n.count>0));
    }
  }

  function addNeed(){
    if(!needForm.tt||!needForm.count) return;
    const exists = needs.find(n=>n.tt===needForm.tt);
    if(exists){ setNeeds(prev=>prev.map(n=>n.tt===needForm.tt?{...n,count:parseInt(needForm.count)||0}:n)); }
    else { setNeeds(prev=>[...prev,{tt:needForm.tt,count:parseInt(needForm.count)||0}]); }
    setNeedForm({tt:"",count:""});
  }

  return (
    <div>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#1a1a2e",letterSpacing:"0.08em",marginBottom:4}}>🔄 GROUND UNITS — SWAP TRACKER</div>
      <div style={{fontSize:10,color:"#9c6b75",marginBottom:20}}>Track customer unit swaps · set how many of each type you need · pending replacement blinks when not yet assigned</div>

      {/* ── UNITS NEEDED COUNTER ── */}
      <div style={{marginBottom:24}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:"#f59e0b",marginBottom:10}}>UNITS NEEDED</div>
        {/* Add need form */}
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            <label style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em"}}>Truck Type</label>
            <select value={needForm.tt} onChange={e=>setNeedForm(f=>({...f,tt:e.target.value}))}
              style={{background:"#ffffff",border:"1px solid #f3c0c8",color:"#1a1a2e",borderRadius:6,padding:"7px 10px",fontFamily:"inherit",fontSize:12,outline:"none"}}>
              <option value="">Select type...</option>
              {TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            <label style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em"}}>How Many Needed</label>
            <input type="number" min="1" max="99" value={needForm.count} onChange={e=>setNeedForm(f=>({...f,count:e.target.value}))}
              placeholder="0"
              style={{background:"#ffffff",border:"1px solid #f3c0c8",color:"#1a1a2e",borderRadius:6,padding:"7px 10px",fontFamily:"inherit",fontSize:12,outline:"none",width:100}}/>
          </div>
          <button onClick={addNeed} style={{background:"#f59e0b",border:"none",borderRadius:6,color:"#fdf2f4",fontSize:12,fontWeight:700,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit",alignSelf:"flex-end"}}>
            Set Need
          </button>
        </div>
        {/* Big number badges */}
        {needs.length===0&&<div style={{fontSize:11,color:"#e8b4bc",padding:"12px 0"}}>No unit needs set yet</div>}
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          {needs.map(n=>(
            <div key={n.tt} style={{background:"#ffffff",border:"1px solid #f59e0b44",borderRadius:10,padding:"14px 20px",textAlign:"center",position:"relative",minWidth:120}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:52,color:"#f59e0b",lineHeight:1}}>{n.count}</div>
              <div style={{fontSize:11,color:"#7a5560",marginTop:4}}>{n.tt}</div>
              <div style={{fontSize:9,color:"#f59e0b",opacity:0.7}}>needed</div>
              <button onClick={()=>setNeeds(prev=>prev.filter(x=>x.tt!==n.tt))}
                style={{position:"absolute",top:6,right:8,background:"none",border:"none",color:"#e8b4bc",cursor:"pointer",fontSize:12}}>✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* ── SWAP PAIRS ── */}
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:"#f59e0b"}}>SWAP PAIRS</div>
          <button onClick={()=>setAddSwapForm({currentUnit:"",tt:"",pendingUnit:""})}
            style={{background:"#f59e0b",border:"none",borderRadius:6,color:"#fdf2f4",fontSize:11,fontWeight:700,padding:"5px 12px",cursor:"pointer",fontFamily:"inherit"}}>
            + Add Swap
          </button>
        </div>

        {/* Add swap form */}
        {addSwapForm&&(
          <div style={{background:"#ffffff",border:"1px solid #f3c0c8",borderRadius:9,padding:"14px",marginBottom:12,display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <label style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em"}}>Current Unit #</label>
              <input placeholder="e.g. 515857" value={addSwapForm.currentUnit} onChange={e=>setAddSwapForm(f=>({...f,currentUnit:e.target.value}))}
                style={{background:"#fdf2f4",border:"1px solid #f3c0c8",color:"#1a1a2e",borderRadius:5,padding:"7px 10px",fontFamily:"inherit",fontSize:12,outline:"none",width:120}}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <label style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em"}}>Truck Type</label>
              <select value={addSwapForm.tt} onChange={e=>setAddSwapForm(f=>({...f,tt:e.target.value}))}
                style={{background:"#fdf2f4",border:"1px solid #f3c0c8",color:"#1a1a2e",borderRadius:5,padding:"7px 10px",fontFamily:"inherit",fontSize:12,outline:"none"}}>
                <option value="">Select...</option>
                {TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <label style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em"}}>Replacement Unit # (optional)</label>
              <input placeholder="Leave blank if pending" value={addSwapForm.pendingUnit||""} onChange={e=>setAddSwapForm(f=>({...f,pendingUnit:e.target.value}))}
                style={{background:"#fdf2f4",border:"1px solid #f3c0c8",color:"#1a1a2e",borderRadius:5,padding:"7px 10px",fontFamily:"inherit",fontSize:12,outline:"none",width:160}}/>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={addSwap} style={{background:"#f59e0b",border:"none",borderRadius:6,color:"#fdf2f4",fontSize:11,fontWeight:700,padding:"7px 14px",cursor:"pointer",fontFamily:"inherit"}}>Add</button>
              <button onClick={()=>setAddSwapForm(null)} style={{background:"transparent",border:"1px solid #f3c0c8",borderRadius:6,color:"#9c6b75",fontSize:11,padding:"7px 12px",cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            </div>
          </div>
        )}

        {swaps.length===0&&!addSwapForm&&<div style={{fontSize:11,color:"#e8b4bc",padding:"12px 0"}}>No swaps added yet — hit + Add Swap to start</div>}

        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {swaps.map(sw=>(
            <div key={sw.id} style={{background:"#ffffff",border:"1px solid #f3c0c8",borderRadius:9,padding:"12px 16px",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
              {/* Current unit */}
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:9,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:3}}>Current</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#1a1a2e"}}>{sw.currentUnit}</div>
                <div style={{fontSize:9,color:"#9c6b75"}}>{sw.tt}</div>
              </div>
              {/* Arrow */}
              <div style={{fontSize:18,color:"#e8b4bc"}}>→</div>
              {/* Pending/replacement unit */}
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:9,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:3}}>Replacement</div>
                {sw.pendingUnit?(
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#4ade80"}}>{sw.pendingUnit}</div>
                ):(
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#f59e0b",animation:"blink 1.2s step-start infinite"}}>PENDING</div>
                )}
              </div>
              {/* Inline pending unit input */}
              {!sw.pendingUnit&&(
                <div style={{display:"flex",gap:6,alignItems:"center",marginLeft:"auto"}}>
                  <input placeholder="Assign unit #" onBlur={e=>{if(e.target.value.trim())updatePending(sw.id,e.target.value.trim());}}
                    onKeyDown={e=>{if(e.key==="Enter"&&e.target.value.trim()){updatePending(sw.id,e.target.value.trim());e.target.value="";}}}
                    style={{background:"#fdf2f4",border:"1px solid #f59e0b55",borderRadius:5,padding:"5px 10px",fontFamily:"inherit",fontSize:12,color:"#1a1a2e",outline:"none",width:130}}/>
                </div>
              )}
              <button onClick={()=>removeSwap(sw.id)} style={{marginLeft:"auto",background:"none",border:"none",color:"#e8b4bc",cursor:"pointer",fontSize:13}}>✕</button>
            </div>
          ))}
        </div>
      </div>
      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}`}</style>
    </div>
  );
}

// ── PUROLATOR FLEET SHEET TAB
function PuroFleetTab({ S, setS, notify }) {
  const [rows, setRows_]         = useState(S.puroFleetRows||[]);
  const [removedUnits, setRemovedUnits_] = useState(S.puroRemovedUnits||[]); // unit#s explicitly removed
  const [editId, setEditId]      = useState(null);
  const [editVals, setEditVals]  = useState({});
  const [msg, setMsg]            = useState(null);
  const [fname, setFname]        = useState("");
  const [sec, setSec]            = useState("all");
  const [showAdd, setShowAdd]    = useState(false);
  const [addForm, setAddForm]    = useState({unit:"",location:"GTT",nextPM:"",status:"Out - Local",comments:"",section:"26 Van (NON-CDL)"});
  const [origBytes, setOrigBytes] = useState(S.puroOrigBytes||null);

  function setRows(fn){
    const n = typeof fn==="function" ? fn(rows) : fn;
    setRows_(n);
    setS(s=>({...s, puroFleetRows:n}));
  }
  function setRemoved(fn){
    const n = typeof fn==="function" ? fn(removedUnits) : fn;
    setRemovedUnits_(n);
    setS(s=>({...s, puroRemovedUnits:n}));
  }

  const yardPuro = Object.values(S.yard||{}).flat().filter(c=>c.isPuro);
  function onYard(u){ return yardPuro.some(p=>String(p.unit).trim()===String(u).trim()); }

  // ── UPLOAD ──
  function upload(file){
    if(!file) return;
    setFname(file.name);
    setMsg({ok:true, msg:"Reading file..."});
    var ext = file.name.split(".").pop().toLowerCase();

    function processArrayBuffer(buf){
      try{
        var X = window.XLSX;
        // Store raw bytes for format-preserving download
        var bytes = new Uint8Array(buf);
        var bin = "";
        for(var i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
        var b64 = btoa(bin);
        setOrigBytes(b64);
        setS(function(sv){ return Object.assign({}, sv, {puroOrigBytes:b64}); });

        var wb = X.read(bytes, {type:"array"});
        var ws = wb.Sheets[wb.SheetNames[0]];

        // Read cells using ABSOLUTE column indices (A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8)
        var parsed = [];
        var section = "";
        var range = X.utils.decode_range(ws["!ref"] || "A1:O41");

        function cv(r, c){
          var a = X.utils.encode_cell({r:r, c:c});
          var cell = ws[a];
          if(!cell || cell.v === null || cell.v === undefined) return "";
          return String(cell.v).trim();
        }

        for(var r = range.s.r; r <= range.e.r; r++){
          var e = cv(r, 4); // Column E always = index 4
          if(!e) continue;
          if(e.indexOf("Van") > -1)     { section = "26 Van (NON-CDL)"; continue; }
          if(e.indexOf("Tractor") > -1) { section = "T/A Tractor (CDL)"; continue; }
          if(e === "Purolator Location" || e.indexOf("PUROLATOR") > -1 || e.indexOf("BELFIELD") > -1) continue;
          // Must be a 5-7 digit number
          var clean = e.replace(/\s/g, "");
          if(!/^\d{5,7}$/.test(clean)) continue;
          parsed.push({
            id: uid(),
            unit: clean,
            location: cv(r,5),
            nextPM:   cv(r,6),
            status:   cv(r,7),
            comments: cv(r,8),
            section:  section,
            _modified: false,
            _orig:    cv(r,8),
            _isNew:   false,
          });
        }

        if(!parsed.length){
          setMsg({ok:false, msg:"No units found. Check the file is the correct Purolator fleet sheet."});
          return;
        }
        setRows(parsed);
        setRemoved([]); // reset removed list on fresh upload
        var m = parsed.filter(function(r){ return onYard(r.unit); }).length;
        setMsg({ok:true, msg:"Loaded "+parsed.length+" units ("+m+" match your yard)"});
      }catch(err){
        setMsg({ok:false, msg:"Error reading Excel: "+err.message});
      }
    }

    function loadAndProcess(){
      var reader = new FileReader();
      reader.onload = function(e){ processArrayBuffer(e.target.result); };
      reader.readAsArrayBuffer(file);
    }

    if(ext === "xlsx" || ext === "xls"){
      if(window.XLSX){
        loadAndProcess();
      } else {
        var s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload = loadAndProcess;
        s.onerror = function(){ setMsg({ok:false, msg:"Could not load Excel library. Please save file as CSV (File > Save As > CSV) and upload that instead."}); };
        document.head.appendChild(s);
      }
    } else if(ext === "csv"){
      var reader2 = new FileReader();
      reader2.onload = function(e){
        // CSV fallback: use offset detection
        try{
          function splitLine(line){
            var r=[],c="",q=false;
            for(var i=0;i<line.length;i++){
              if(line[i]==='"'){q=!q;}
              else if(line[i]===','&&!q){r.push(c);c="";}
              else{c+=line[i];}
            }
            r.push(c);
            return r.map(function(v){return v.replace(/^"|"$/g,"").trim();});
          }
          var lines = e.target.result.split(/\r?\n/);
          var offset = 4;
          for(var i=0;i<Math.min(15,lines.length);i++){
            var tc = splitLine(lines[i]);
            if((tc[3]||"").indexOf("Van")>-1||(tc[3]||"").indexOf("PUROLATOR")>-1){ offset=3; break; }
          }
          var parsed=[], section="";
          for(var i=0;i<lines.length;i++){
            var cols = splitLine(lines[i]);
            var e2 = (cols[offset]||"").trim();
            if(e2.indexOf("Van")>-1){ section="26 Van (NON-CDL)"; continue; }
            if(e2.indexOf("Tractor")>-1){ section="T/A Tractor (CDL)"; continue; }
            if(!e2||e2==="Purolator Location"||e2.indexOf("PUROLATOR")>-1) continue;
            var clean = e2.replace(/\s/g,"");
            if(!/^\d{5,7}$/.test(clean)) continue;
            parsed.push({id:uid(),unit:clean,location:(cols[offset+1]||"").trim(),nextPM:(cols[offset+2]||"").trim(),status:(cols[offset+3]||"").trim(),comments:(cols[offset+4]||"").trim(),section:section,_modified:false,_orig:(cols[offset+4]||"").trim(),_isNew:false});
          }
          if(!parsed.length){ setMsg({ok:false,msg:"No units found in CSV"}); return; }
          setRows(parsed);
          setRemoved([]);
          var m=parsed.filter(function(r){return onYard(r.unit);}).length;
          setMsg({ok:true,msg:"Loaded "+parsed.length+" units ("+m+" match your yard)"});
        }catch(err){ setMsg({ok:false,msg:"CSV error: "+err.message}); }
      };
      reader2.readAsText(file);
    } else {
      setMsg({ok:false, msg:"Please upload an Excel (.xlsx) or CSV (.csv) file"});
    }
  }

  // ── ADD UNIT ──
  function addUnit(){
    if(!addForm.unit.trim()){ notify("Enter a unit number"); return; }
    if(rows.find(function(r){ return r.unit===addForm.unit.trim(); })){ notify("Unit already exists"); return; }
    setRows(function(prev){
      return [...prev, {id:uid(), unit:addForm.unit.trim(), location:addForm.location, nextPM:addForm.nextPM, status:addForm.status||"Out - Local", comments:addForm.comments, section:addForm.section, _modified:true, _orig:"", _isNew:true}];
    });
    setAddForm({unit:"",location:"GTT",nextPM:"",status:"Out - Local",comments:"",section:"26 Van (NON-CDL)"});
    setShowAdd(false);
    notify("Unit "+addForm.unit.trim()+" added");
  }

  // ── REMOVE UNIT ── track it so download knows to blank it
  function removeUnit(id){
    var row = rows.find(function(r){ return r.id===id; });
    setRows(function(prev){ return prev.filter(function(r){ return r.id!==id; }); });
    if(row && !row._isNew){
      setRemoved(function(prev){ return [...prev, row.unit]; });
    }
    notify("Unit removed — will be blanked in downloaded file");
  }

  // ── EDIT ──
  function startEdit(row){ setEditId(row.id); setEditVals({location:row.location, nextPM:row.nextPM, status:row.status, comments:row.comments}); }
  function saveEdit(id){
    setRows(function(prev){
      return prev.map(function(r){
        if(r.id!==id) return r;
        var changed = editVals.comments!==r._orig || editVals.status!==r.status || editVals.nextPM!==r.nextPM || editVals.location!==r.location;
        return Object.assign({}, r, editVals, {_modified:changed});
      });
    });
    setEditId(null);
    notify("Row updated");
  }

  // ── DOWNLOAD — patches original bytes ──
  function download(){
    if(!rows.length){ notify("No units to download"); return; }
    if(!origBytes){ notify("Please re-upload the Excel file first"); return; }

    function run(){
      try{
        var binStr = atob(origBytes);
        var bytes  = new Uint8Array(binStr.length);
        for(var i=0;i<binStr.length;i++) bytes[i]=binStr.charCodeAt(i);

        window.JSZip.loadAsync(bytes).then(function(zip){
          Promise.all([
            zip.file("xl/sharedStrings.xml").async("string"),
            zip.file("xl/worksheets/sheet1.xml").async("string")
          ]).then(function(parts){
            var ssXml    = parts[0];
            var sheetXml = parts[1];

            // Parse shared strings into array
            var ssArr = [];
            var siRe  = /<si>([\s\S]*?)<\/si>/g;
            var tm;
            while((tm = siRe.exec(ssXml)) !== null){
              var tv = tm[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
              ssArr.push(tv.map(function(t){
                return t.replace(/<t[^>]*>/,"").replace(/<\/t>/,"");
              }).join(""));
            }
            var ssMap = {};
            ssArr.forEach(function(s,i){ ssMap[s] = i; });
            function getOrAdd(val){
              val = String(val || "");
              if(ssMap.hasOwnProperty(val)) return ssMap[val];
              var idx = ssArr.length;
              ssArr.push(val);
              ssMap[val] = idx;
              return idx;
            }

            // Build unit# -> Excel row number map from col E
            var u2r = {};
            var cre = /<c r="E(\d+)"[^>]*>[\s\S]*?<v>(\d+)<\/v>/g;
            var cm;
            while((cm = cre.exec(sheetXml)) !== null){
              if(/^\d{5,7}$/.test(cm[2])) u2r[cm[2]] = parseInt(cm[1]);
            }

            // Patch a single cell — NEVER touches s= style attribute
            function patch(xml, col, rn, val){
              var addr = col + rn;
              var re2  = new RegExp('(<c r="' + addr + '"[^>]*)(>[\\s\\S]*?)(<\\/c>)');
              var hit  = re2.exec(xml);
              if(!hit) return xml;
              var tag   = hit[1];
              var close = hit[3];
              if(val === ""){
                return xml.slice(0, hit.index) + tag + ">" + close + xml.slice(hit.index + hit[0].length);
              }
              var idx = getOrAdd(val);
              var newTag = tag.indexOf('t="s"') < 0 ? tag + ' t="s"' : tag;
              var newCell = newTag + '><v>' + idx + '</v>' + close;
              return xml.slice(0, hit.index) + newCell + xml.slice(hit.index + hit[0].length);
            }

            // 1. Blank explicitly removed units
            removedUnits.forEach(function(unit){
              var rn = u2r[unit];
              if(!rn) return;
              ["E","F","G","H","I"].forEach(function(col){
                sheetXml = patch(sheetXml, col, rn, "");
              });
            });

            // 2. Patch edited rows (F,G,H,I only — never overwrite unit# in E)
            rows.forEach(function(r){
              if(r._isNew) return;
              var rn = u2r[r.unit];
              if(!rn) return;
              sheetXml = patch(sheetXml, "F", rn, r.location);
              sheetXml = patch(sheetXml, "G", rn, r.nextPM);
              sheetXml = patch(sheetXml, "H", rn, r.status);
              sheetXml = patch(sheetXml, "I", rn, r.comments);
            });

            // 3. Append new units after last existing row
            var newUnits = rows.filter(function(r){ return r._isNew; });
            if(newUnits.length){
              var styleM  = sheetXml.match(/<c r="E6" s="(\d+)"/);
              var ds      = styleM ? styleM[1] : "6";
              var rowNums = sheetXml.match(/r="[A-Z]+(\d+)"/g) || [];
              var maxRow  = 41;
              rowNums.forEach(function(mx){
                var n = parseInt(mx.replace(/[^0-9]/g,""));
                if(n > maxRow) maxRow = n;
              });
              var nextRow    = maxRow + 1;
              var newRowsXml = "";
              newUnits.forEach(function(r){
                var colE  = r.unit || "";
                var colFi = getOrAdd(r.location  || "");
                var colGi = getOrAdd(r.nextPM    || "");
                var colHi = getOrAdd(r.status    || "");
                var colIi = getOrAdd(r.comments  || "");
                var rx = '<row r="' + nextRow + '" spans="2:15" ht="19.5" customHeight="1">'
                  + '<c r="E' + nextRow + '" s="' + ds + '"><v>' + colE  + '</v></c>'
                  + '<c r="F' + nextRow + '" s="' + ds + '" t="s"><v>' + colFi + '</v></c>'
                  + '<c r="G' + nextRow + '" s="' + ds + '" t="s"><v>' + colGi + '</v></c>'
                  + '<c r="H' + nextRow + '" s="' + ds + '" t="s"><v>' + colHi + '</v></c>'
                  + '<c r="I' + nextRow + '" s="' + ds + '" t="s"><v>' + colIi + '</v></c>'
                  + '</row>';
                newRowsXml += rx;
                nextRow++;
              });
              sheetXml = sheetXml.replace("</sheetData>", newRowsXml + "</sheetData>");
            }

            // Rebuild shared strings XML
            var siBlock = ssArr.map(function(s){
              return '<si><t xml:space="preserve">'
                + s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
                + '</t></si>';
            }).join("");
            var newSs = ssXml.replace(
              /(<sst[^>]*>)[\s\S]*?(<\/sst>)/,
              function(whole, open, close){
                open = open
                  .replace(/count="[^"]*"/,       'count="'       + ssArr.length + '"')
                  .replace(/uniqueCount="[^"]*"/, 'uniqueCount="' + ssArr.length + '"');
                return open + siBlock + close;
              }
            );

            zip.file("xl/sharedStrings.xml",        newSs);
            zip.file("xl/worksheets/sheet1.xml", sheetXml);

            zip.generateAsync({type:"uint8array", compression:"DEFLATE"}).then(function(out){
              var blob = new Blob([out], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
              var url  = URL.createObjectURL(blob);
              var a    = document.createElement("a");
              a.href     = url;
              a.download = (fname || "Purolator_Update")
                .replace(/[.](xlsx|xls|csv)$/i, "") + "_updated.xlsx";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              notify("Downloaded — original formatting fully preserved");
            });

          }).catch(function(err){ notify("XML read error: " + err.message); });
        }).catch(function(err){ notify("Zip error: " + err.message); });
      }catch(err){
        notify("Error: " + err.message);
        console.error(err);
      }
    }

    if(window.JSZip){
      run();
    } else {
      var s = document.createElement("script");
      s.src    = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = run;
      s.onerror = function(){ notify("Could not load JSZip"); };
      document.head.appendChild(s);
    }
  }

  var sections = [...new Set(rows.map(function(r){ return r.section; }).filter(Boolean))];
  var displayed = sec==="all" ? rows : rows.filter(function(r){ return r.section===sec; });
  var matched   = rows.filter(function(r){ return onYard(r.unit); });

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:16}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#a855f7",letterSpacing:"0.08em"}}>PUROLATOR FLEET SHEET</div>
          <div style={{fontSize:10,color:"#9c6b75",marginTop:1}}>Upload master sheet, edit any row, download updated Excel with original formatting</div>
        </div>
        {rows.length>0&&(
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            {[["Vans",rows.filter(function(r){return r.section&&r.section.indexOf("Van")>-1;}).length,"#7dd3fc"],["Tractors",rows.filter(function(r){return r.section&&r.section.indexOf("Tractor")>-1;}).length,"#c4b5fd"],["On Yard",matched.length,"#a855f7"],["Modified",rows.filter(function(r){return r._modified;}).length,"#f59e0b"]].map(function(item){
              return (
                <div key={item[0]} style={{textAlign:"center",background:"#fff",border:"1px solid "+item[2],borderRadius:7,padding:"5px 12px"}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:item[2]}}>{item[1]}</div>
                  <div style={{fontSize:9,color:"#9c6b75",textTransform:"uppercase"}}>{item[0]}</div>
                </div>
              );
            })}
            <button onClick={function(){setShowAdd(function(v){return !v;});}} style={{background:"#16a34a",border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,padding:"8px 14px",cursor:"pointer",fontFamily:"inherit"}}>+ Add Unit</button>
            <button onClick={download} style={{background:"#7c3aed",border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit"}}>Download Updated Excel</button>
          </div>
        )}
      </div>

      <label style={{display:"block",border:"2px dashed #d8b4fe",borderRadius:10,padding:"20px",textAlign:"center",cursor:"pointer",background:"#fdf4ff",marginBottom:12}}>
        <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={function(e){upload(e.target.files[0]);}}/>
        <div style={{fontSize:22,marginBottom:4}}>🟣</div>
        <div style={{fontSize:12,color:"#a855f7",fontWeight:600}}>{rows.length>0?"Re-upload Master Sheet":"Upload Purolator Master Fleet Sheet"}</div>
        <div style={{fontSize:10,color:"#7c3aed",marginTop:2}}>Apr_8th_Purolator_Update.xlsx or .csv</div>
      </label>

      {rows.length===0&&!msg&&(
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
          <button onClick={function(){setShowAdd(function(v){return !v;});}} style={{background:"#16a34a",border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,padding:"7px 14px",cursor:"pointer",fontFamily:"inherit"}}>+ Add Unit Manually</button>
        </div>
      )}

      {msg&&(
        <div style={{marginBottom:12,padding:"8px 12px",background:msg.ok?"#f0fdf4":"#fff5f5",border:"1px solid "+(msg.ok?"#16a34a":"#ef4444"),borderRadius:6,fontSize:11,color:msg.ok?"#15803d":"#dc2626"}}>
          {msg.msg}
        </div>
      )}

      {showAdd&&(
        <div style={{background:"#f0fdf4",border:"2px solid #16a34a",borderRadius:10,padding:"16px",marginBottom:16}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:"#15803d",marginBottom:12,letterSpacing:"0.06em"}}>ADD NEW UNIT TO FLEET SHEET</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:10}}>
            {[["unit","Unit #","e.g. 515857"],["nextPM","Next PM Date","e.g. Apr/29/2026"],["comments","Comments","Optional..."]].map(function(f){
              return (
                <div key={f[0]}>
                  <div style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{f[1]}</div>
                  <input placeholder={f[2]} value={addForm[f[0]]} onChange={function(e){var v=e.target.value;setAddForm(function(prev){return Object.assign({},prev,{[f[0]]:v});});}}
                    style={{width:"100%",background:"#fff",border:"1px solid #16a34a",color:"#1a1a2e",borderRadius:6,padding:"7px 10px",fontFamily:"inherit",fontSize:12,outline:"none"}}/>
                </div>
              );
            })}
            <div>
              <div style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>Section</div>
              <select value={addForm.section} onChange={function(e){var v=e.target.value;setAddForm(function(p){return Object.assign({},p,{section:v});});}}
                style={{width:"100%",background:"#fff",border:"1px solid #16a34a",color:"#1a1a2e",borderRadius:6,padding:"7px 10px",fontFamily:"inherit",fontSize:12,outline:"none"}}>
                <option value="26 Van (NON-CDL)">26 Van (NON-CDL)</option>
                <option value="T/A Tractor (CDL)">T/A Tractor (CDL)</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>Location</div>
              <select value={addForm.location} onChange={function(e){var v=e.target.value;setAddForm(function(p){return Object.assign({},p,{location:v});});}}
                style={{width:"100%",background:"#fff",border:"1px solid #16a34a",color:"#1a1a2e",borderRadius:6,padding:"7px 10px",fontFamily:"inherit",fontSize:12,outline:"none"}}>
                <option value="GTT">GTT</option>
                <option value="Vulcan">Vulcan</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>Status</div>
              <input value={addForm.status} onChange={function(e){var v=e.target.value;setAddForm(function(p){return Object.assign({},p,{status:v});});}}
                style={{width:"100%",background:"#fff",border:"1px solid #16a34a",color:"#1a1a2e",borderRadius:6,padding:"7px 10px",fontFamily:"inherit",fontSize:12,outline:"none"}}/>
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={addUnit} style={{background:"#16a34a",border:"none",borderRadius:6,color:"#fff",fontSize:12,fontWeight:700,padding:"8px 20px",cursor:"pointer",fontFamily:"inherit"}}>Add Unit</button>
            <button onClick={function(){setShowAdd(false);}} style={{background:"transparent",border:"1px solid #f3c0c8",borderRadius:6,color:"#9c6b75",fontSize:12,padding:"8px 14px",cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
          </div>
        </div>
      )}

      {matched.length>0&&(
        <div style={{background:"#fdf4ff",border:"1px solid #d8b4fe",borderRadius:9,padding:"12px 16px",marginBottom:16}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:13,color:"#7c3aed",marginBottom:8}}>YARD UNITS FOUND IN FLEET SHEET</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {matched.map(function(r){
              var editing = editId===r.id;
              return (
                <div key={r.id} style={{background:"#ede9fe",border:"1px solid #a855f7",borderRadius:7,padding:"8px 12px",minWidth:160}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#7c3aed"}}>{r.unit}</div>
                  <div style={{fontSize:9,color:"#9333ea",marginBottom:4}}>{r.section}</div>
                  {editing?(
                    <div>
                      {[["location","Location"],["nextPM","Next PM"],["status","Status"],["comments","Comments"]].map(function(kl){
                        var k=kl[0],lab=kl[1];
                        return (
                          <div key={k} style={{marginBottom:4}}>
                            <div style={{fontSize:8,color:"#7c3aed",textTransform:"uppercase",marginBottom:2}}>{lab}</div>
                            <input value={editVals[k]||""} onChange={function(e){var v=e.target.value;setEditVals(function(f){return Object.assign({},f,{[k]:v});});}}
                              style={{width:"100%",background:"#fff",border:"1px solid #a855f7",color:"#1a1a2e",borderRadius:4,padding:"3px 6px",fontFamily:"inherit",fontSize:11,outline:"none"}}/>
                          </div>
                        );
                      })}
                      <div style={{display:"flex",gap:4,marginTop:4}}>
                        <button onClick={function(){saveEdit(r.id);}} style={{flex:1,background:"#7c3aed",border:"none",borderRadius:4,color:"#fff",fontSize:10,fontWeight:700,padding:"4px",cursor:"pointer",fontFamily:"inherit"}}>Save</button>
                        <button onClick={function(){setEditId(null);}} style={{background:"transparent",border:"1px solid #d8b4fe",borderRadius:4,color:"#9c6b75",fontSize:10,padding:"4px 6px",cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                      </div>
                    </div>
                  ):(
                    <div>
                      <div style={{fontSize:9,color:"#7c3aed",marginBottom:2}}>{r.nextPM} - {r.status}</div>
                      <div style={{fontSize:10,color:r._modified?"#f59e0b":r.comments?"#6b4c52":"#c4b5fd",marginBottom:4}}>{r.comments||"No comment"}</div>
                      <div style={{display:"flex",gap:4}}>
                        <button onClick={function(){startEdit(r);}} style={{flex:1,background:"#7c3aed",border:"none",borderRadius:4,color:"#fff",fontSize:9,fontWeight:700,padding:"3px",cursor:"pointer",fontFamily:"inherit"}}>Edit</button>
                        <button onClick={function(){removeUnit(r.id);}} style={{background:"transparent",border:"1px solid #fca5a5",borderRadius:4,color:"#dc2626",fontSize:9,padding:"3px 6px",cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
        {["all",...sections].map(function(s){
          return (
            <button key={s} onClick={function(){setSec(s);}}
              style={{border:"none",borderRadius:5,padding:"4px 12px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:sec===s?"#a855f7":"#fff",color:sec===s?"#fff":"#9c6b75"}}>
              {s==="all"?"All":s}
            </button>
          );
        })}
      </div>

      {sections.filter(function(s){ return sec==="all"||s===sec; }).map(function(sectionName){
        var sRows = displayed.filter(function(r){ return r.section===sectionName; });
        if(!sRows.length) return null;
        return (
          <div key={sectionName} style={{marginBottom:16,background:"#fff",border:"1px solid #f3c0c8",borderRadius:9,overflow:"hidden"}}>
            <div style={{background:"#7c3aed",padding:"8px 16px",fontFamily:"'Bebas Neue',sans-serif",fontSize:13,color:"#fff",letterSpacing:"0.06em"}}>{sectionName} - {sRows.length} units</div>
            <div style={{display:"grid",gridTemplateColumns:"90px 70px 90px 90px 1fr 90px",padding:"6px 14px",borderBottom:"1px solid #f3c0c8",fontSize:9,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.06em"}}>
              <div>Unit</div><div>Location</div><div>Next PM</div><div>Status</div><div>Comments</div><div/>
            </div>
            {sRows.map(function(row, i){
              var yard = onYard(row.unit);
              var editing = editId===row.id;
              if(editing){
                return (
                  <div key={row.id} style={{padding:"10px 14px",borderBottom:i<sRows.length-1?"1px solid #f3c0c8":undefined,background:"#fdf4ff"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"#7c3aed"}}>{row.unit}</span>
                      {yard&&<span style={{fontSize:8,color:"#a855f7",fontWeight:700}}>ON YARD</span>}
                      <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                        <button onClick={function(){saveEdit(row.id);}} style={{background:"#7c3aed",border:"none",borderRadius:5,color:"#fff",fontSize:11,fontWeight:700,padding:"4px 14px",cursor:"pointer",fontFamily:"inherit"}}>Save</button>
                        <button onClick={function(){setEditId(null);}} style={{background:"transparent",border:"1px solid #f3c0c8",borderRadius:5,color:"#9c6b75",fontSize:11,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 2fr",gap:10}}>
                      {[["location","Location"],["nextPM","Next PM Date"],["status","Status"],["comments","Comments"]].map(function(kl){
                        var k=kl[0],lab=kl[1];
                        return (
                          <div key={k}>
                            <div style={{fontSize:9,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>{lab}</div>
                            <input value={editVals[k]||""} onChange={function(e){var v=e.target.value;setEditVals(function(f){return Object.assign({},f,{[k]:v});});}}
                              style={{width:"100%",background:"#fff",border:"1px solid #a855f7",color:"#1a1a2e",borderRadius:5,padding:"5px 8px",fontFamily:"inherit",fontSize:11,outline:"none"}}/>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              return (
                <div key={row.id+"v"} style={{display:"grid",gridTemplateColumns:"90px 70px 90px 90px 1fr 90px",padding:"9px 14px",borderBottom:i<sRows.length-1?"1px solid #f3c0c8":undefined,background:yard?"#fdf4ff":row._modified?"#fefce8":row._isNew?"#f0fdf4":undefined,alignItems:"center"}}>
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:yard?"#7c3aed":"#1a1a2e"}}>{row.unit}</div>
                    {yard&&<div style={{fontSize:8,color:"#a855f7",fontWeight:700}}>ON YARD</div>}
                    {row._isNew&&<div style={{fontSize:8,color:"#16a34a",fontWeight:700}}>NEW</div>}
                  </div>
                  <div style={{fontSize:11,color:"#9c6b75"}}>{row.location}</div>
                  <div style={{fontSize:10,color:"#d97706"}}>{row.nextPM}</div>
                  <div style={{fontSize:10,color:"#6b4c52"}}>{row.status}</div>
                  <div style={{fontSize:11,color:row._modified?"#d97706":row.comments?"#1a1a2e":"#d8b4fe"}}>{row.comments||"—"}</div>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={function(){startEdit(row);}} style={{background:"transparent",border:"1px solid #f3c0c8",borderRadius:4,color:"#9c6b75",fontSize:9,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit"}}>Edit</button>
                    <button onClick={function(){removeUnit(row.id);}} style={{background:"transparent",border:"1px solid #fca5a5",borderRadius:4,color:"#dc2626",fontSize:9,padding:"3px 6px",cursor:"pointer",fontFamily:"inherit"}} title="Remove from sheet">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {rows.length===0&&!msg&&(
        <div style={{textAlign:"center",padding:"40px 0",color:"#d8b4fe",fontSize:12}}>Upload your Purolator master fleet sheet to get started</div>
      )}
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const [S, setS_]       = useState(BLANK());
  const [history, setHistory] = useState([]); // array of { dayNum, label, snap }
  const [dayNum, setDayNum]   = useState(1);  // current operational day number
  const [dayLabel, setDayLabel] = useState(todayStr()); // label shown in header
  const [tab, setTab]  = useState("dash");
  const [modal, setModal] = useState(null); // { type, tt, card }
  const [form, setForm]   = useState({});
  const [search, setSearch] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const [historyViewDay, setHistoryViewDay] = useState(null); // snapshot being viewed
  const [goModal, setGoModal] = useState(null); // { card, tt }
  const [goForm, setGoForm]   = useState({ customer:"", returnDate:"" });
  const [removeQ, setRemoveQ] = useState("");
  const [taskInput, setTaskInput] = useState("");
  const [notification, setNotification] = useState("");

  const setS = fn => setS_(s => fn(s));

  function notify(msg){ setNotification(msg); setTimeout(()=>setNotification(""),2500); }

  // ── DAY MANAGEMENT ──────────────────────────────────────────────────────
  function newDay(){
    // Save current operational day to history (keyed by day number, never overwrites)
    const snap = JSON.parse(JSON.stringify(S));
    const currentLabel = dayLabel;
    const currentNum = dayNum;
    setHistory(h => [...h, { dayNum: currentNum, label: currentLabel, snap }]);

    // Next operational day
    const nextNum = currentNum + 1;
    const nextLabel = todayStr(); // use real date for the label
    setDayNum(nextNum);
    setDayLabel(nextLabel);

    // Build new day state
    const ns = BLANK();

    // Yard: keep units physically present (not wentOut), reset daily flags
    TRUCK_TYPES.forEach(tt=>{
      ns.yard[tt] = (S.yard[tt]||[])
        .filter(c => !c.wentOut)
        .map(c=>({...c, goingOut:false, wentOut:false}));
    });

    // Reso: all cards carry forward until checked in
    TRUCK_TYPES.forEach(tt=>{
      ns.reso[tt] = (S.reso[tt]||[]).map(c=>({...c, checkInPending:false}));
    });

    // PM board + hikes carry forward
    ns.pm    = (S.pm||[]).map(c=>({...c}));
    ns.hikes = (S.hikes||[]).map(c=>({...c}));
    ns.pmScheduled = (S.pmScheduled||[]).map(c=>({...c}));
    // PM checklist rows: only carry pending + scheduled — done rows stay in history only
    ns.pmRows = (S.pmRows||[]).filter(r=>r.status!=="done").map(r=>({...r,_prev:null}));

    // Auto return reminders
    TRUCK_TYPES.forEach(tt=>{
      (ns.reso[tt]||[]).forEach(card=>{
        const d = daysUntil(card.returnDate);
        if(d===1) ns.tasks.push({ id:uid(), done:false, type:"return", unit:card.unit, tt,
          text:`Remind customer to drop off unit ${card.unit} — due TOMORROW` });
        if(d===0) ns.tasks.push({ id:uid(), done:false, type:"return", unit:card.unit, tt,
          text:`Unit ${card.unit} is due back TODAY — confirm drop-off` });
        if(d<0) ns.tasks.push({ id:uid(), done:false, type:"overdue", unit:card.unit, tt,
          text:`⚠️ Unit ${card.unit} is ${Math.abs(d)} day(s) OVERDUE — follow up with customer` });
      });
    });

    // Auto PM tasks from scheduled PM rows
    (S.pmScheduled||[]).forEach(pmRow=>{
      if(!pmRow.scheduledDate) return;
      const d = daysUntil(pmRow.scheduledDate);
      if(d===1){
        ns.tasks.push({ id:uid(), done:false, type:"pm", unit:pmRow.unit,
          text:`Remind customer to drop off unit ${pmRow.unit} for PM — scheduled TOMORROW` });
        if(pmRow.swapRequired){
          if(pmRow.swapUnit){
            ns.tasks.push({ id:uid(), done:false, type:"pm-swap", unit:pmRow.unit,
              text:"Make sure swap unit "+pmRow.swapUnit+" is available for unit "+pmRow.unit+"s PM tomorrow"+(pmRow.pmType?" ("+pmRow.pmType+" type)":"") });
          } else {
            ns.tasks.push({ id:uid(), done:false, type:"pm-swap", unit:pmRow.unit,
              text:`🔄 Unit ${pmRow.unit} PM is tomorrow — make sure a${pmRow.pmType?" "+pmRow.pmType:""} swap unit is available` });
          }
        }
      }
      if(d===0){
        ns.tasks.push({ id:uid(), done:false, type:"pm", unit:pmRow.unit,
          text:`Unit ${pmRow.unit} PM is scheduled TODAY — confirm drop-off` });
        if(pmRow.swapRequired&&pmRow.swapUnit)
          ns.tasks.push({ id:uid(), done:false, type:"pm-swap", unit:pmRow.unit,
            text:`✅ Is swap unit ${pmRow.swapUnit} here for unit ${pmRow.unit}?` });
      }
    });

    setS_(ns);
    setTab("dash");
    notify(`Day ${nextNum} started ✓`);
  }

  // View a past day's snapshot (read-only peek — does not replace live state)
  // History is just for reference, we never go "back"
  function viewDay(entry){ setHistOpen(false); setTab("dash"); /* future: show snapshot modal */ }

  // ── YARD ────────────────────────────────────────────────────────────────
  function saveYard(){
    if(!form.unit?.trim()) return;
    const tt=modal.tt;
    const hikeId = uid();
    const isHikeIn  = !!form.hikeIn  && !modal.card;
    const isHikeOut = !!form.hikeOut && !modal.card;
    const card={
      id:form.id||uid(), unit:form.unit.trim(), line:form.line||"RL",
      isPuro:!!form.isPuro, note:form.note||"", shopDate:form.shopDate||"",
      goingOut:!!form.goingOut, wentOut:!!form.wentOut,
      awaitingArrival: isHikeIn,
      hikeId: isHikeIn ? hikeId : undefined,
    };
    setS(s=>{
      let ns;
      if(isHikeOut){
        // Hike out: don't add to yard, add to hikes outbound + sent
        const hikeCard={id:hikeId,unit:card.unit,tt,dir:"out",location:"",arrival:"",placed:false,ready:false,pmDue:false,note:form.note||""};
        const sentExists=s.sent.find(c=>c.unit===card.unit);
        ns={...s,
          hikes:[...s.hikes,hikeCard],
          sent:sentExists?s.sent:[...s.sent,{id:uid(),unit:card.unit,tt,location:"",note:"Hike out"}],
        };
      } else {
        // Normal add (or hike in — card goes to yard as awaiting arrival)
        const arr=modal.card?s.yard[tt].map(c=>c.id===card.id?card:c):[...s.yard[tt],card];
        ns={...s,yard:{...s.yard,[tt]:arr}};
        // Hike in: also add to hikes inbound
        if(isHikeIn && !ns.hikes.find(h=>h.unit===card.unit&&h.dir==="in")){
          const hikeCard={id:hikeId,unit:card.unit,tt,dir:"in",location:"",arrival:"",placed:false,ready:false,pmDue:false,note:form.note||""};
          ns={...ns,hikes:[...ns.hikes,hikeCard]};
        }
      }
      // Quick action side effects (skip for hike out since unit isn't on yard)
      if(!isHikeOut){
        if(form.addPM && !ns.pm.find(p=>p.unit===card.unit))
          ns={...ns,pm:[...ns.pm,{id:uid(),unit:card.unit,tt,pmDate:"",note:""}]};
        if(form.addTomorrow && !(ns.tomorrow[tt]||[]).find(c=>c.unit===card.unit))
          ns={...ns,tomorrow:{...ns.tomorrow,[tt]:[...(ns.tomorrow[tt]||[]),{id:uid(),unit:card.unit,note:"From yard",hold:true}]}};
        if(form.addCheckin){
          if(!ns.tasks.find(t=>t.unit===card.unit&&t.type==="checkin"))
            ns={...ns,tasks:[...ns.tasks,{id:uid(),done:false,type:"checkin",unit:card.unit,text:`Check in unit ${card.unit} (${tt})`}]};
          if(!ns.checkins.find(c=>c.unit===card.unit))
            ns={...ns,checkins:[...ns.checkins,{id:uid(),unit:card.unit,tt,hikedFrom:"",note:""}]};
        }
      }
      return ns;
    });
    closeModal();
    notify(isHikeOut?`Unit ${form.unit.trim()} hiked out → Hikes ↑ ✓`:isHikeIn?`Unit ${form.unit.trim()} added as Awaiting Arrival → Hikes ↓ ✓`:"Unit saved ✓");
  }

  function markGoingOut(tt,card){
    setS(s=>({...s,yard:{...s.yard,[tt]:s.yard[tt].map(c=>c.id===card.id?{...c,goingOut:!c.goingOut,wentOut:c.goingOut?false:c.wentOut}:c)}}));
  }

  function openWentOut(tt,card){
    setGoModal({card,tt});
    setGoForm({customer:card.customer||"",returnDate:twoWeeks()});
  }

  function confirmWentOut(){
    const {card,tt}=goModal;
    const {customer,returnDate}=goForm;
    if(!returnDate) return;
    setS(s=>({
      ...s,
      yard:{...s.yard,[tt]:s.yard[tt].filter(c=>c.id!==card.id)},
      reso:{...s.reso,[tt]:[...(s.reso[tt]||[]),{id:uid(),unit:card.unit,returnDate,customer,note:"Going out today",tt}]},
    }));
    setGoModal(null);
    notify(`Unit ${card.unit} moved to Short Term Reso ✓`);
  }

  function quickPM(tt,card){
    setS(s=>{
      // Add to yard pm list
      const ns = s.pm.find(p=>p.unit===card.unit)?s:{...s,pm:[...s.pm,{id:uid(),unit:card.unit,tt,pmDate:"",note:""}]};
      // Also add to PM checklist rows if not already there
      const pmRowExists=(ns.pmRows||[]).find(r=>r.unit===card.unit);
      if(!pmRowExists){
        const newRow={id:uid(),unit:card.unit,pmType:"",customer:"",nextPM:"",daysLeft:0,defeDays:"",comment:"",status:"pending",scheduledDate:"",swapRequired:false,swapUnit:"",notes:"From yard",_prev:null};
        return {...ns,pmRows:[...(ns.pmRows||[]),newRow],pmInitialized:true};
      }
      return {...ns,pmInitialized:true};
    });
    notify(`Unit ${card.unit} added to PM schedule ✓`);
  }
  function quickTomorrow(tt,card){
    setS(s=>(s.tomorrow[tt]||[]).find(c=>c.unit===card.unit)?s:{...s,tomorrow:{...s.tomorrow,[tt]:[...(s.tomorrow[tt]||[]),{id:uid(),unit:card.unit,note:"From yard",hold:true}]}});
    notify(`Unit ${card.unit} added to Tomorrow ✓`);
  }

  // Quick hike out — opens a destination modal before acting
  const [hikeOutModal, setHikeOutModal] = useState(null); // { card, tt }
  const [hikeOutDest, setHikeOutDest]   = useState("");

  function quickHikeOut(tt, card){
    setHikeOutModal({card, tt});
    setHikeOutDest("");
  }

  function confirmHikeOut(){
    const {card, tt} = hikeOutModal;
    const location = hikeOutDest.trim();
    setS(s=>{
      const hikeExists = s.hikes.find(h=>h.unit===card.unit&&h.dir==="out");
      if(hikeExists) return s;
      const hikeCard = {id:uid(),unit:card.unit,tt,dir:"out",location,arrival:"",placed:false,ready:false,pmDue:false,note:"Hike out from yard"};
      const sentExists = s.sent.find(c=>c.unit===card.unit);
      const newSent = sentExists ? s.sent : [...s.sent,{id:uid(),unit:card.unit,tt,location,note:"Hike out"}];
      const newYard = {...s.yard,[tt]:s.yard[tt].filter(c=>c.id!==card.id)};
      return {...s, hikes:[...s.hikes,hikeCard], sent:newSent, yard:newYard};
    });
    notify(`Unit ${card.unit} hiked out to ${location||"unknown"} ✓`);
    setHikeOutModal(null);
    setHikeOutDest("");
  }

  // Quick hike in — marks unit as awaiting arrival, adds to hikes section (inbound)
  const [hikeInModal, setHikeInModal]   = useState(null); // { card, tt }
  const [hikeInFrom,  setHikeInFrom]    = useState("");

  function quickHikeIn(tt, card){
    setHikeInModal({card, tt});
    setHikeInFrom("");
  }

  function confirmHikeIn(){
    const {card, tt} = hikeInModal;
    const location = hikeInFrom.trim();
    setS(s=>{
      const hikeExists = s.hikes.find(h=>h.unit===card.unit&&h.dir==="in");
      if(hikeExists) return s;
      const hikeCard = {id:uid(),unit:card.unit,tt,dir:"in",location,arrival:"",placed:false,ready:false,pmDue:false,note:"Hike in to yard"};
      const newYard = {...s.yard,[tt]:s.yard[tt].map(c=>c.id===card.id?{...c,awaitingArrival:true,hikeId:hikeCard.id,note:`Hiked from ${location||"other location"}`}:c)};
      return {...s, hikes:[...s.hikes,hikeCard], yard:newYard};
    });
    notify(`Unit ${card.unit} awaiting arrival from ${location||"other location"} ✓`);
    setHikeInModal(null);
    setHikeInFrom("");
  }

  // ── RESO ────────────────────────────────────────────────────────────────
  function saveReso(){
    if(!form.unit?.trim()) return;
    const tt=modal.tt;
    const card={id:form.id||uid(),unit:form.unit.trim(),returnDate:form.returnDate||"",customer:form.customer||"",note:form.note||"",tt};
    setS(s=>{ const arr=modal.card?s.reso[tt].map(c=>c.id===card.id?card:c):[...s.reso[tt],card]; return {...s,reso:{...s.reso,[tt]:arr}}; });
    closeModal();
  }

  function checkInFromReso(tt,card){
    setS(s=>{
      const taskExists=s.tasks.find(t=>t.unit===card.unit&&t.type==="checkin"&&!t.done);
      if(taskExists) return s;
      const taskId=uid();
      const newTask={
        id:taskId, done:false, type:"checkin", unit:card.unit,
        text:`Check in unit ${card.unit} (${tt}) — returning from reso`,
        resoCardId:card.id, resoTT:tt, customer:card.customer||"",
      };
      // Mark reso card pending
      const newReso={...s.reso,[tt]:s.reso[tt].map(c=>c.id===card.id?{...c,checkInPending:true}:c)};
      // Also add to checkins panel so it shows as "Awaiting Check In"
      const ciExists=s.checkins.find(c=>c.unit===card.unit);
      const newCI=ciExists?s.checkins:[...s.checkins,{id:uid(),unit:card.unit,tt,hikedFrom:"",note:"Awaiting check in from reso",awaitingCheckin:true}];
      return {...s, tasks:[...s.tasks,newTask], reso:newReso, checkins:newCI};
    });
    notify(`Unit ${card.unit} added to tasks & check-in list — tick off when unit arrives ✓`);
  }

  // ── TOMORROW ────────────────────────────────────────────────────────────
  function saveTomorrow(){
    if(!form.unit?.trim()) return;
    const tt=modal.tt;
    const card={id:form.id||uid(),unit:form.unit.trim(),note:form.note||"",hold:!!form.hold};
    setS(s=>{ const arr=modal.card?s.tomorrow[tt].map(c=>c.id===card.id?card:c):[...s.tomorrow[tt],card]; return {...s,tomorrow:{...s.tomorrow,[tt]:arr}}; });
    closeModal();
  }
  function toggleHold(tt,id){ setS(s=>({...s,tomorrow:{...s.tomorrow,[tt]:s.tomorrow[tt].map(c=>c.id===id?{...c,hold:!c.hold}:c)}})); }

  // ── PM ──────────────────────────────────────────────────────────────────
  function savePM(){
    if(!form.unit?.trim()) return;
    const card={id:form.id||uid(),unit:form.unit.trim(),tt:form.tt||"",pmDate:form.pmDate||"",note:form.note||""};
    setS(s=>({...s,pm:modal.card?s.pm.map(c=>c.id===card.id?card:c):[...s.pm,card]}));
    closeModal();
  }

  // ── HIKES ───────────────────────────────────────────────────────────────
  function saveHike(){
    if(!form.unit?.trim()) return;
    const card={id:form.id||uid(),unit:form.unit.trim(),tt:form.tt||"",dir:form.dir||"in",location:form.location||"",arrival:form.arrival||"",placed:!!form.placed,ready:!!form.ready,pmDue:!!form.pmDue,note:form.note||"",awaitingArrival:form.dir==="in"};
    setS(s=>{
      const newHikes=modal.card?s.hikes.map(c=>c.id===card.id?card:c):[...s.hikes,card];
      let ns={...s,hikes:newHikes};
      // PM side effect
      if(card.pmDue&&!ns.pm.find(p=>p.unit===card.unit))
        ns={...ns,pm:[...ns.pm,{id:uid(),unit:card.unit,tt:card.tt,pmDate:"",note:"Via hike"}]};
      // Outbound hike: also add to Sent panel so it's tracked there
      if(card.dir==="out"&&!ns.sent.find(c=>c.unit===card.unit))
        ns={...ns,sent:[...ns.sent,{id:uid(),unit:card.unit,tt:card.tt,location:card.location,note:`Hike out · arrival ${card.arrival||"TBD"}`}]};
      // Inbound hike: add to yard as "Awaiting Arrival" so it shows on the board
      if(card.dir==="in"&&!modal.card){
        const ttKey=card.tt||TRUCK_TYPES[0];
        if(!(ns.yard[ttKey]||[]).find(c=>c.unit===card.unit))
          ns={...ns,yard:{...ns.yard,[ttKey]:[...(ns.yard[ttKey]||[]),{id:uid(),unit:card.unit,line:"RL",isPuro:false,note:"Awaiting arrival",shopDate:"",goingOut:false,wentOut:false,awaitingArrival:true,hikeId:card.id}]}};
      }
      return ns;
    });
    closeModal();
    notify(card.dir==="out"?`Outbound hike for ${card.unit} placed — added to Sent ✓`:`Inbound hike for ${card.unit} — added to yard as Awaiting Arrival ✓`);
  }
  function toggleHikeField(id,f){ setS(s=>({...s,hikes:s.hikes.map(h=>h.id===id?{...h,[f]:!h[f]}:h)})); }

  // Confirm inbound hike arrived — removes awaiting flag, becomes normal yard unit
  function confirmHikeArrival(tt, card){
    setS(s=>({...s,
      yard:{...s.yard,[tt]:s.yard[tt].map(c=>c.id===card.id?{...c,awaitingArrival:false,note:"",hikeId:undefined}:c)},
      hikes:s.hikes.map(h=>h.id===card.hikeId?{...h,placed:true,ready:true}:h),
    }));
    notify(`Unit ${card.unit} arrived — now a regular yard unit ✓`);
  }

  // ── SENT / CHECKINS ─────────────────────────────────────────────────────
  function saveSent(){
    if(!form.unit?.trim()) return;
    const card={id:form.id||uid(),unit:form.unit.trim(),tt:form.tt||"",location:form.location||"",note:form.note||""};
    setS(s=>({...s,sent:modal.card?s.sent.map(c=>c.id===card.id?card:c):[...s.sent,card]}));
    closeModal();
  }
  function saveCheckin(){
    if(!form.unit?.trim()) return;
    const card={id:form.id||uid(),unit:form.unit.trim(),tt:form.tt||"",hikedFrom:form.customer||"",note:form.note||""};
    setS(s=>{
      const newCI = modal.card ? s.checkins.map(c=>c.id===card.id?card:c) : [...s.checkins,card];
      // If new check-in (hike placed), add unit to yard as awaiting arrival
      if(!modal.card && card.tt){
        const yardExists = (s.yard[card.tt]||[]).find(c=>c.unit===card.unit);
        if(!yardExists){
          const newYardCard = {id:uid(),unit:card.unit,line:"RL",isPuro:false,note:`Hiked from ${card.hikedFrom||"other location"}`,shopDate:"",goingOut:false,wentOut:false,awaitingArrival:true};
          return {...s, checkins:newCI, yard:{...s.yard,[card.tt]:[...(s.yard[card.tt]||[]),newYardCard]}};
        }
      }
      return {...s, checkins:newCI};
    });
    closeModal();
    notify(`Unit ${form.unit.trim()} added to yard as Awaiting Arrival ✓`);
  }

  // ── TASKS ───────────────────────────────────────────────────────────────
  function toggleTask(id){
    setS(s=>{
      const task = s.tasks.find(t=>t.id===id);
      if(!task) return s;
      const nowDone = !task.done;
      // Base: toggle the task
      let ns={...s, tasks:s.tasks.map(t=>t.id===id?{...t,done:nowDone}:t)};
      // If completing a reso check-in task → move unit to yard + remove from reso
      if(nowDone && task.type==="checkin" && task.resoCardId && task.resoTT){
        const tt=task.resoTT;
        // Add to yard as WL (just returned from rental)
        const yardExists=(ns.yard[tt]||[]).find(c=>c.unit===task.unit);
        if(!yardExists){
          ns={...ns,yard:{...ns.yard,[tt]:[...(ns.yard[tt]||[]),
            {id:uid(),unit:task.unit,line:"WL",isPuro:false,note:"Returned from reso",shopDate:"",goingOut:false,wentOut:false}
          ]}};
        }
        // Remove from reso
        ns={...ns,reso:{...ns.reso,[tt]:ns.reso[tt].filter(c=>c.id!==task.resoCardId)}};
        // Remove from checkins panel (it's now on yard)
        ns={...ns,checkins:ns.checkins.filter(c=>c.unit!==task.unit)};
      }
      // If un-completing a reso check-in task → restore reso card pending state
      if(!nowDone && task.type==="checkin" && task.resoCardId && task.resoTT){
        const tt=task.resoTT;
        // Remove from yard if it was added
        ns={...ns,yard:{...ns.yard,[tt]:ns.yard[tt].filter(c=>c.unit!==task.unit||c.note!=="Returned from reso")}};
        // Restore reso card (it may have been removed — can't restore if gone, but mark un-pending if still there)
        ns={...ns,reso:{...ns.reso,[tt]:ns.reso[tt].map(c=>c.id===task.resoCardId?{...c,checkInPending:false}:c)}};
      }
      return ns;
    });
  }
  function addTask(text){ if(!text.trim()) return; setS(s=>({...s,tasks:[...s.tasks,{id:uid(),done:false,type:"general",unit:"",text:text.trim()}]})); }
  function delTask(id){ setS(s=>({...s,tasks:s.tasks.filter(t=>t.id!==id)})); }

  // ── REMOVE UNIT EVERYWHERE ──────────────────────────────────────────────
  function removeUnit(u){
    if(!u.trim()) return;
    setS(s=>{
      const y={},r={},t={};
      TRUCK_TYPES.forEach(tt=>{ y[tt]=(s.yard[tt]||[]).filter(c=>c.unit!==u); r[tt]=(s.reso[tt]||[]).filter(c=>c.unit!==u); t[tt]=(s.tomorrow[tt]||[]).filter(c=>c.unit!==u); });
      return {...s,yard:y,reso:r,tomorrow:t,pm:s.pm.filter(c=>c.unit!==u),tasks:s.tasks.filter(c=>c.unit!==u),hikes:s.hikes.filter(c=>c.unit!==u),sent:s.sent.filter(c=>c.unit!==u),checkins:s.checkins.filter(c=>c.unit!==u)};
    });
    notify(`Unit ${u} removed from all sections ✓`);
    setRemoveQ("");
  }

  // ── MODAL HELPERS ────────────────────────────────────────────────────────
  function openModal(type,tt=null,card=null){
    setModal({type,tt,card});
    if(card && type==="yard"){
      // Check both the yard PM list AND the imported PM checklist (pmRows)
    const hasPM=S.pm.find(p=>p.unit===card.unit) || (S.pmRows||[]).find(p=>p.unit===card.unit&&p.status!=="done");
      const hasTom=Object.values(S.tomorrow).flat().find(c=>c.unit===card.unit);
      const hasCI=S.checkins.find(c=>c.unit===card.unit);
      setForm({...card,addPM:!!hasPM,addTomorrow:!!hasTom,addCheckin:!!hasCI,goingOut:!!card.goingOut});
    } else {
      setForm(card?{...card}:{unit:"",line:"RL",isPuro:false,note:"",shopDate:"",returnDate:"",customer:"",pmDate:"",dir:"in",location:"",arrival:"",placed:false,ready:false,pmDue:false,hold:false,addPM:false,addTomorrow:false,addCheckin:false,tt:tt||""});
    }
  }
  function closeModal(){ setModal(null); setForm({}); }
  const sf = k => e => setForm(f=>({...f,[k]:e.target.type==="checkbox"?e.target.checked:e.target.value}));

  // ── STATS ────────────────────────────────────────────────────────────────
  const totalYard  = TRUCK_TYPES.reduce((a,t)=>a+(S.yard[t]||[]).length,0);
  const totalReso  = TRUCK_TYPES.reduce((a,t)=>a+(S.reso[t]||[]).length,0);
  const totalTom   = TRUCK_TYPES.reduce((a,t)=>a+(S.tomorrow[t]||[]).length,0);
  const avail      = TRUCK_TYPES.reduce((a,t)=>a+(S.yard[t]||[]).filter(c=>["RL","WL","SRL"].includes(c.line)&&!c.isPuro&&!c.goingOut).length,0);
  const goingOut   = TRUCK_TYPES.reduce((a,t)=>a+(S.yard[t]||[]).filter(c=>c.goingOut).length,0);
  const tasksDone  = S.tasks.filter(t=>t.done).length;
  const returnAlerts = [];
  TRUCK_TYPES.forEach(tt=>{ (S.reso[tt]||[]).forEach(c=>{ const d=daysUntil(c.returnDate); if(d===0||d===-1||d<0) returnAlerts.push({...c,tt,days:d}); else if(d===1) returnAlerts.push({...c,tt,days:d}); }); });

  // ── SEARCH ───────────────────────────────────────────────────────────────
  const searchResults = !search.trim() ? null : (() => {
    const q=search.trim().toLowerCase(), res=[];
    TRUCK_TYPES.forEach(tt=>{
      (S.yard[tt]||[]).forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:"Yard",tt,unit:c.unit,detail:c.line}); });
      (S.reso[tt]||[]).forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:"Reso",tt,unit:c.unit,detail:c.returnDate?`Back ${fmtDate(c.returnDate)}`:""}); });
      (S.tomorrow[tt]||[]).forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:"Tomorrow",tt,unit:c.unit,detail:c.hold?"HOLD":""}); });
    });
    S.pm.forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:"PM",tt:c.tt,unit:c.unit,detail:c.pmDate?fmtDate(c.pmDate):""}); });
    S.hikes.forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:`Hike ${c.dir==="in"?"↓":"↑"}`,tt:c.tt,unit:c.unit,detail:c.location}); });
    S.sent.forEach(c=>{ if(c.unit.toLowerCase().includes(q)) res.push({where:"Sent",tt:c.tt,unit:c.unit,detail:c.location}); });
    return res;
  })();

  const TABS = [["dash","📋 Dashboard"],["pm","🔧 PM"],["ground","🔄 Ground Units"],["puro","🟣 Purolator Fleet"],["hikes","✈️ Hikes"],["other","📤 Sent & CI"],["tasks","✅ Tasks"]];

  // ── YARD CARD (reused in both dashboard and yard tab) ────────────────────
  const YardCard = ({card,tt}) => {
    const ls=card.isPuro?LINE.PUR:(LINE[card.line]||LINE.RL);
    // Check both the yard PM list AND the imported PM checklist (pmRows)
    const hasPM=S.pm.find(p=>p.unit===card.unit) || (S.pmRows||[]).find(p=>p.unit===card.unit&&p.status!=="done");
    const hasTom=Object.values(S.tomorrow||{}).flat().find(c=>c.unit===card.unit);
    const hasCheckinPending=S.tasks.find(t=>t.unit===card.unit&&t.type==="checkin"&&!t.done);

    // Awaiting arrival (inbound hike) — special state
    if(card.awaitingArrival){
      return (
        <div className="ucard" style={{background:"#f0fff4",border:"2px dashed #16a34a",color:"#4ade80",position:"relative"}}>
          <div className="unum">{card.unit}</div>
          <div className="usub" style={{color:"#4ade80",opacity:0.7}}>✈️ Awaiting arrival</div>
          {card.note&&<div className="usub">{card.note}</div>}
          <div className="qa-row" onClick={e=>e.stopPropagation()}>
            <button style={{background:"#16a34a",border:"none",borderRadius:4,color:"#fdf2f4",fontSize:9,fontWeight:700,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit"}}
              onClick={()=>confirmHikeArrival(tt,card)}>✅ Arrived</button>
          </div>
          <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,yard:{...s.yard,[tt]:s.yard[tt].filter(c=>c.id!==card.id)}}));}}>✕</button>
        </div>
      );
    }

    const tomEntry = hasTom; // the tomorrow entry for this unit
    return (
      <div className={`ucard ${card.goingOut?"ucard-go":""}`} style={{background:ls.bg,color:ls.text,outline:hasTom&&!card.goingOut?"2px solid #f59e0b":undefined,outlineOffset:hasTom&&!card.goingOut?"1px":undefined}} onClick={()=>openModal("yard",tt,card)}>
        <div className={`unum ${hasPM?"pm-b":""}`}>{card.unit}</div>
        <div className="usub">{card.isPuro?"PURO":card.line}{card.note?" · "+card.note:""}</div>
        {card.shopDate&&<div className="usub">Out: {fmtDate(card.shopDate)}</div>}
        {hasPM&&<div className="usub">🔧 PM sch.</div>}
        {/* Tomorrow strip — shown on card body */}
        {hasTom&&!card.goingOut&&(
          <div style={{marginTop:4,background:"#fff7ed",border:"1px solid #f59e0b",borderRadius:3,padding:"2px 5px",fontSize:8,color:"#fcd34d",fontWeight:700}}>
            📅 NEEDED TOMORROW{tomEntry?.hold?" · 🔴 HOLD":""}
          </div>
        )}
        {card.goingOut&&(
          <div className="go-strip" style={{background:card.wentOut?"#14532d":undefined,borderColor:card.wentOut?"#16a34a":undefined}}>
            {card.wentOut?"✅ WENT OUT":"🚀 GOING OUT"}{card.returnDate?` · back ${fmtDate(card.returnDate)}`:""}
          </div>
        )}
        {hasCheckinPending&&(
          <div style={{marginTop:4,background:"#dcfce7",border:"1px solid #4ade80",borderRadius:3,padding:"2px 5px",fontSize:8,color:"#4ade80",fontWeight:700}}>
            ✅ AWAITING CHECK IN
          </div>
        )}
        <div className="qa-row" onClick={e=>e.stopPropagation()}>
          <button className={`qa-go ${card.goingOut?"on":""}`} onClick={()=>markGoingOut(tt,card)}>{card.goingOut?"✓ Out":"🚀 Out"}</button>
          {card.goingOut&&!card.wentOut&&<button className="qa-btn" style={{background:"#eff6ff",color:"#93c5fd"}} onClick={()=>openWentOut(tt,card)}>📋 Went Out</button>}
          {card.wentOut&&<span className="qa-badge green">✓ In Reso</span>}
          {/* Hike Out — removes from yard, adds to hikes outbound */}
          {!card.goingOut&&!card.wentOut&&!card.awaitingArrival&&(
            <button className="qa-btn" style={{background:"#4c1d95",color:"#c4b5fd"}} onClick={()=>quickHikeOut(tt,card)}>↑ Hike Out</button>
          )}
          {/* Hike In — marks awaiting arrival, adds to hikes inbound */}
          {!card.awaitingArrival&&(
            <button className="qa-btn" style={{background:"#14532d",color:"#86efac"}} onClick={()=>quickHikeIn(tt,card)}>↓ Hike In</button>
          )}
          {hasPM&&<span className="qa-badge orange">🔧 PM</span>}
        </div>
        <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,yard:{...s.yard,[tt]:s.yard[tt].filter(c=>c.id!==card.id)}}));}}>✕</button>
      </div>
    );
  };

  // ── RESO CARD (reused) ───────────────────────────────────────────────────
  const ResoCard = ({card,tt}) => {
    const days=daysUntil(card.returnDate);
    const overdue=days!==null&&days<0, urgent=days===0, soon=days===1;
    const cdLabel=days===null?"":overdue?`${Math.abs(days)}d overdue`:urgent?"due TODAY":soon?"due TOMORROW":`${days}d left`;
    const cdColor=overdue||urgent?"#ef4444":soon?"#f59e0b":"#475569";
    return (
      <div className={`reso-card ${urgent||overdue?"r-urgent":soon?"r-soon":""}`} style={card.checkInPending?{borderColor:"#4ade80",boxShadow:"0 0 8px #4ade8033"}:{}} onClick={()=>openModal("reso",tt,card)}>
        <div style={{fontSize:13,fontWeight:700,color:"#93c5fd"}}>{card.unit}</div>
        {card.customer&&<div style={{fontSize:9,color:"#7dd3fc",marginTop:1}}>{card.customer}</div>}
        {card.returnDate&&<div style={{fontSize:9,color:"#64748b",marginTop:2}}>Back {urgent?"TODAY":soon?"TOMORROW":`${fmtDate(card.returnDate)}`}</div>}
        {cdLabel&&<div style={{fontSize:10,fontWeight:700,color:cdColor}}>{cdLabel}</div>}
        {!card.checkInPending&&(
          <button onClick={e=>{e.stopPropagation();checkInFromReso(tt,card);}} className="ci-btn">✅ Add to Daily Tasks</button>
        )}
        {card.checkInPending&&(
          <div style={{marginTop:6,background:"#1c3a1c",border:"2px solid #4ade80",borderRadius:6,padding:"6px 8px",textAlign:"center"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#4ade80"}}>⏳ AWAITING CHECK-IN</div>
            <div style={{fontSize:9,color:"#86efac",marginTop:2}}>Task added → tick off in Daily Tasks when unit arrives</div>
          </div>
        )}
        <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,reso:{...s.reso,[tt]:s.reso[tt].filter(c=>c.id!==card.id)}}));}}>✕</button>
      </div>
    );
  };

  // ── BOARD GRID (reused) ──────────────────────────────────────────────────
  const BoardGrid = ({data,renderCard,addCard,style={}}) => (
    <div className="grid" style={style}>
      {TRUCK_TYPES.map(tt=>(
        <div key={tt}>
          <div className="col-hdr" title={tt}>{tt}</div>
          <div className="bcol">
            {(data[tt]||[]).map(c=>renderCard(c,tt))}
            {addCard&&<div className="add-btn" onClick={()=>addCard(tt)}>+</div>}
          </div>
        </div>
      ))}
    </div>
  );

  // ── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:"'Inter',sans-serif",minHeight:"100vh",background:"#fdf2f4",color:"#1a1a2e"}}>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-thumb{background:#f3c0c8;border-radius:4px;}
        ::-webkit-scrollbar-track{background:#fdf2f4;}
        body,#root{font-family:'Inter',sans-serif;}
        input,select,textarea{background:#fff;border:1.5px solid #f3c0c8;color:#1a1a2e;border-radius:8px;padding:8px 12px;font-family:inherit;font-size:13px;width:100%;outline:none;transition:border 0.15s;box-shadow:0 1px 3px rgba(225,29,72,0.06);}
        input:focus,select:focus,textarea:focus{border-color:#e11d48;box-shadow:0 0 0 3px rgba(225,29,72,0.1);}
        select option{background:#fff;color:#1a1a2e;}
        textarea{resize:vertical;min-height:56px;}
        .btn{cursor:pointer;border:none;border-radius:8px;font-family:inherit;font-size:12px;font-weight:600;padding:8px 16px;transition:all 0.15s;}
        .btn-amber{background:#f59e0b;color:#fff;box-shadow:0 2px 6px rgba(245,158,11,0.3);}.btn-amber:hover{background:#d97706;transform:translateY(-1px);}
        .btn-ghost{background:#fff;color:#6b4c52;border:1.5px solid #f3c0c8;}.btn-ghost:hover{border-color:#e11d48;color:#e11d48;}
        .btn-green{background:#16a34a;color:#fff;box-shadow:0 2px 6px rgba(22,163,74,0.3);}.btn-green:hover{background:#15803d;transform:translateY(-1px);}
        .btn-red{background:#fee2e2;color:#dc2626;border:1.5px solid #fca5a5;}.btn-red:hover{background:#fecaca;}
        .btn-sm{padding:5px 12px;font-size:11px;}
        .overlay{position:fixed;inset:0;background:rgba(100,20,40,0.45);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;}
        .modal{background:#fff;border:1.5px solid #f3c0c8;border-radius:16px;padding:24px;width:100%;max-width:440px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(225,29,72,0.15);}
        .field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px;}
        .field label{font-size:10px;color:#9c6b75;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .section-title{font-family:'Bebas Neue',sans-serif;letter-spacing:0.08em;font-size:22px;margin-bottom:4px;}
        .section-sub{font-size:11px;color:#9c6b75;margin-bottom:10px;}
        .grid{display:grid;grid-template-columns:repeat(10,minmax(110px,1fr));gap:2px;background:#f9d5dc;border:1.5px solid #f3c0c8;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(225,29,72,0.08);}
        .col-hdr{font-size:9px;color:#9c6b75;text-transform:uppercase;letter-spacing:0.07em;text-align:center;padding:6px 4px;border-bottom:1.5px solid #f3c0c8;background:#fff0f3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;}
        .bcol{background:#fdf2f4;padding:7px;min-height:110px;display:flex;flex-direction:column;gap:6px;}
        .ucard{border-radius:10px;padding:8px 9px 6px;cursor:pointer;position:relative;transition:transform 0.15s,box-shadow 0.15s;box-shadow:0 2px 6px rgba(0,0,0,0.08);}
        .ucard:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,0.12);}
        .ucard-go{outline:2px solid #f97316;outline-offset:2px;box-shadow:0 0 12px rgba(249,115,22,0.35)!important;}
        .unum{font-size:13px;font-weight:700;line-height:1.2;}
        .pm-b{text-decoration:underline dotted;text-underline-offset:2px;}
        .usub{font-size:9px;opacity:0.75;margin-top:2px;line-height:1.3;}
        .go-strip{margin-top:5px;background:#fff7ed;border:1px solid #f97316;border-radius:4px;padding:2px 6px;font-size:8px;color:#c2410c;font-weight:700;}
        .qa-row{display:flex;gap:3px;margin-top:6px;flex-wrap:wrap;}
        .qa-go{border:1px solid #fed7aa;border-radius:5px;cursor:pointer;font-size:8px;padding:3px 7px;font-family:inherit;font-weight:700;background:#fff7ed;color:#ea580c;transition:all 0.1s;}
        .qa-go.on{background:#f97316;color:#fff;border-color:#f97316;}
        .qa-btn{border:1px solid #bfdbfe;border-radius:5px;cursor:pointer;font-size:8px;padding:3px 7px;font-family:inherit;font-weight:700;background:#eff6ff;color:#2563eb;}
        .qa-badge{border-radius:4px;font-size:8px;padding:2px 6px;font-weight:700;display:inline-flex;align-items:center;}
        .qa-badge.green{background:#dcfce7;color:#16a34a;border:1px solid #bbf7d0;}
        .qa-badge.amber{background:#fef9c3;color:#ca8a04;border:1px solid #fde68a;}
        .qa-badge.orange{background:#fff7ed;color:#ea580c;border:1px solid #fed7aa;}
        .add-btn{background:#fff;border:2px dashed #f3c0c8;border-radius:8px;color:#f3c0c8;font-size:20px;text-align:center;cursor:pointer;padding:7px;user-select:none;transition:all 0.15s;}
        .add-btn:hover{border-color:#e11d48;color:#e11d48;background:#fff5f7;}
        .xcbtn{position:absolute;top:4px;right:4px;background:rgba(255,255,255,0.85);border:none;border-radius:4px;cursor:pointer;font-size:9px;padding:2px 5px;color:#9c6b75;font-weight:700;line-height:1;}
        .xcbtn:hover{background:#fff;color:#e11d48;}
        .tab{cursor:pointer;padding:9px 16px;font-size:12px;font-weight:600;border:none;background:transparent;color:#9c6b75;font-family:inherit;border-bottom:2.5px solid transparent;transition:all 0.15s;white-space:nowrap;}
        .tab.on{color:#e11d48;border-bottom:2.5px solid #e11d48;}.tab:hover:not(.on){color:#6b4c52;}
        .reso-card{background:#fff;border:1.5px solid #bfdbfe;border-radius:10px;padding:10px;cursor:pointer;position:relative;transition:transform 0.15s,box-shadow 0.15s;box-shadow:0 2px 8px rgba(59,130,246,0.08);}
        .reso-card:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(59,130,246,0.12);}
        .r-urgent{border-color:#fca5a5!important;box-shadow:0 0 10px rgba(239,68,68,0.2)!important;}
        .r-soon{border-color:#fde68a!important;}
        .ci-btn{margin-top:7px;width:100%;background:#dcfce7;border:1.5px solid #16a34a;border-radius:6px;color:#15803d;font-size:10px;font-weight:700;padding:5px;cursor:pointer;font-family:inherit;transition:all 0.15s;}
        .ci-btn:hover{background:#bbf7d0;}
        .ci-pending{margin-top:6px;background:#f0fdf4;border:1.5px solid #4ade80;border-radius:6px;color:#15803d;font-size:9px;padding:4px 7px;text-align:center;font-weight:600;}
        .tom-card{background:#fff;border:1.5px solid #fde68a;border-radius:10px;padding:8px 10px;cursor:pointer;position:relative;box-shadow:0 2px 8px rgba(234,179,8,0.1);}
        .hold-badge{background:#fee2e2;color:#dc2626;border-radius:4px;font-size:8px;padding:2px 6px;font-weight:700;display:inline-block;margin-top:3px;}
        .pm-card{background:#fff;border:1.5px solid #fed7aa;border-radius:10px;padding:10px 12px;cursor:pointer;position:relative;transition:border-color 0.15s;box-shadow:0 2px 6px rgba(249,115,22,0.08);}
        .pm-card:hover{border-color:#f97316;}
        .hike-card{border-radius:10px;padding:12px;position:relative;box-shadow:0 2px 8px rgba(0,0,0,0.05);}
        .hike-in{background:#f0fdf4;border:1.5px solid #86efac;}.hike-out{background:#fdf4ff;border:1.5px solid #d8b4fe;}
        .side-card{background:#fff;border:1.5px solid #f3c0c8;border-radius:10px;padding:10px 12px;position:relative;transition:all 0.15s;cursor:pointer;box-shadow:0 2px 6px rgba(225,29,72,0.05);}
        .side-card:hover{border-color:#e11d48;box-shadow:0 4px 14px rgba(225,29,72,0.1);}
        .chk-box{width:17px;height:17px;border-radius:4px;border:2px solid #f3c0c8;background:#fff;cursor:pointer;appearance:none;flex-shrink:0;margin-top:2px;transition:all 0.15s;}
        .chk-box:checked{background:#e11d48;border-color:#e11d48;}
        .tog{display:flex;align-items:center;gap:8px;cursor:pointer;}
        .tog input[type=checkbox]{width:15px;height:15px;cursor:pointer;accent-color:#e11d48;}
        .stat-box{text-align:center;}
        .stat-num{font-family:'Bebas Neue',sans-serif;font-size:24px;line-height:1;}
        .stat-lbl{font-size:9px;color:#9c6b75;text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;font-weight:600;}
        .avail{background:#dcfce7;border:1.5px solid #16a34a;border-radius:8px;padding:5px 14px;display:inline-flex;flex-direction:column;align-items:center;box-shadow:0 2px 8px rgba(22,163,74,0.15);}
        .notif{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a2e;border:none;border-radius:10px;padding:11px 22px;font-size:13px;color:#fff;z-index:200;pointer-events:none;animation:fadein 0.2s;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.2);}
        @keyframes fadein{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .alert-bar{background:#fff5f5;border-bottom:2px solid #fca5a5;padding:7px 18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;}
        .alert-chip{background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;}
        .alert-chip.soon{background:#fef9c3;color:#ca8a04;border-color:#fde68a;}
        .search-res{display:flex;flex-wrap:wrap;gap:8px;padding:12px 18px;border-bottom:1.5px solid #f3c0c8;background:#fff;}
        .search-chip{background:#fff;border:1.5px solid #f3c0c8;border-radius:8px;padding:7px 12px;min-width:115px;box-shadow:0 1px 4px rgba(225,29,72,0.06);}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{borderBottom:"1px solid #1f2937",padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"#e11d48",letterSpacing:"0.1em"}}>BRANCH OPS</div>
          <div style={{fontSize:11,color:"#9c6b75",fontWeight:500}}>Day {dayNum} · {dayLabel}</div>
        </div>

        {/* Stats */}
        <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
          {[["Yard",totalYard,"#7dd3fc"],["Reso",totalReso,"#f59e0b"],["Tmrw",totalTom,"#fcd34d"],["PM",(S.pmRows||[]).filter(r=>r.status!=="done").length,"#fb923c"],["Hikes",S.hikes.length,"#67e8f9"]].map(([l,v,c])=>(
            <div key={l} className="stat-box"><div className="stat-num" style={{color:c}}>{v}</div><div className="stat-lbl">{l}</div></div>
          ))}
          <div className="avail">
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#4ade80"}}>{avail}</div>
            <div style={{fontSize:9,color:"#166534",textTransform:"uppercase",letterSpacing:"0.06em"}}>Available</div>
          </div>
          {goingOut>0&&<div className="stat-box"><div className="stat-num" style={{color:"#f97316"}}>{goingOut}</div><div className="stat-lbl">Going Out</div></div>}
          {S.tasks.length>0&&<div className="stat-box"><div className="stat-num" style={{color:tasksDone===S.tasks.length?"#4ade80":"#a07880"}}>{tasksDone}/{S.tasks.length}</div><div className="stat-lbl">Tasks</div></div>}
        </div>

        {/* Controls */}
        <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
          {/* Search */}
          <div style={{position:"relative"}}>
            <input style={{background:"#ffffff",border:"1px solid #f3c0c8",borderRadius:6,padding:"6px 12px",fontFamily:"inherit",fontSize:12,color:"#1a1a2e",outline:"none",width:170}} placeholder="🔍 Search unit #" value={search} onChange={e=>setSearch(e.target.value)}/>
            {search&&<button style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#9c6b75",cursor:"pointer"}} onClick={()=>setSearch("")}>✕</button>}
          </div>
          {/* Remove */}
          <div style={{display:"flex",gap:5}}>
            <input style={{background:"#1c0a0a",border:"1px solid #ef444466",borderRadius:6,padding:"6px 10px",fontFamily:"inherit",fontSize:12,color:"#fca5a5",outline:"none",width:130}} placeholder="Unit # remove" value={removeQ} onChange={e=>setRemoveQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&removeQ&&removeUnit(removeQ)}/>
            <button className="btn btn-red btn-sm" onClick={()=>removeQ&&removeUnit(removeQ)}>🗑</button>
          </div>
          {/* History */}
          <button className="btn btn-ghost btn-sm" onClick={()=>setHistOpen(true)}>📅 History {history.length>0?`(${history.length})`:""}</button>
          <button className="btn btn-green btn-sm" onClick={newDay}>🌅 Start Day {dayNum+1}</button>
        </div>
      </div>

      {/* Return Alerts */}
      {returnAlerts.length>0&&(
        <div className="alert-bar">
          <span style={{fontSize:10,color:"#ef4444",fontWeight:700}}>⚠️ RETURNS:</span>
          {returnAlerts.map((a,i)=>(
            <span key={i} className={`alert-chip ${a.days===1?"soon":""}`}>
              #{a.unit} — {a.days<0?`${Math.abs(a.days)}d OVERDUE`:a.days===0?"TODAY":"TOMORROW"} ({fmtDate(a.returnDate)})
            </span>
          ))}
        </div>
      )}

      {/* Search results */}
      {searchResults&&(
        <div className="search-res">
          {searchResults.length===0
            ?<div style={{fontSize:11,color:"#9c6b75"}}>No results for "{search}"</div>
            :searchResults.map((r,i)=>(
              <div key={i} className="search-chip">
                <div style={{fontSize:12,fontWeight:700,color:"#1a1a2e"}}>{r.unit}</div>
                <div style={{fontSize:9,color:"#7a5560",marginTop:1}}>{r.where}{r.tt?" · "+r.tt:""}</div>
                {r.detail&&<div style={{fontSize:9,color:"#f59e0b",marginTop:1}}>{r.detail}</div>}
              </div>
            ))
          }
        </div>
      )}

      {/* Legend */}
      <div style={{padding:"5px 18px",borderBottom:"1px solid #1f2937",display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        {Object.entries(LINE).map(([k,v])=>(
          <div key={k} style={{display:"flex",alignItems:"center",gap:4}}>
            <div style={{width:8,height:8,borderRadius:2,background:v.bg,flexShrink:0}}/>
            <span style={{fontSize:9,color:"#7a5560"}}>{k} – {v.label}</span>
          </div>
        ))}
        <span style={{fontSize:9,color:"#7a5560",marginLeft:4}}>· <strong style={{color:"#1a1a2e",textDecoration:"underline dotted"}}>underline</strong> = PM due</span>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",padding:"0 18px",borderBottom:"1px solid #1f2937",overflowX:"auto"}}>
        {TABS.map(([id,label])=>(
          <button key={id} className={`tab ${tab===id?"on":""}`} onClick={()=>setTab(id)}>{label}</button>
        ))}
      </div>

      <div style={{padding:"20px 20px",overflowX:"auto"}}>

        {/* ══ DASHBOARD ══ */}
        {tab==="dash"&&(
          <div style={{display:"flex",flexDirection:"column",gap:28}}>

            {/* MY YARD TODAY */}
            <div>
              <div className="section-title" style={{color:"#1a1a2e"}}>MY YARD TODAY</div>
              <div className="section-sub">Tap card to edit · 🚀 Out = going out today → Went Out moves to Reso</div>
              <BoardGrid
                data={S.yard}
                renderCard={(card,tt)=><YardCard key={card.id} card={card} tt={tt}/>}
                addCard={tt=>openModal("yard",tt)}
              />
            </div>

            {/* SHORT TERM RESO */}
            <div>
              <div className="section-title" style={{color:"#93c5fd"}}>SHORT TERM RESO</div>
              <div className="section-sub">Carries forward daily · Check In returns unit to yard as WL</div>
              <BoardGrid
                data={S.reso}
                style={{background:"#f0f4ff",borderColor:"#1e3a5f"}}
                renderCard={(card,tt)=><ResoCard key={card.id} card={card} tt={tt}/>}
                addCard={tt=>openModal("reso",tt)}
              />
            </div>

            {/* NEED FOR TOMORROW */}
            <div>
              <div className="section-title" style={{color:"#fcd34d"}}>NEED FOR TOMORROW</div>
              <div className="section-sub">🔴 HOLD = reserved for reso — do not give out</div>
              <div className="grid" style={{background:"#fff7e6",borderColor:"#78350f"}}>
                {TRUCK_TYPES.map(tt=>(
                  <div key={tt}>
                    <div className="col-hdr" style={{background:"#fff7e6",borderBottom:"1px solid #78350f",color:"#92400e"}} title={tt}>{tt}</div>
                    <div className="bcol" style={{background:"#fff9f0"}}>
                      {(S.tomorrow[tt]||[]).map(card=>(
                        <div key={card.id} className="tom-card" onClick={()=>openModal("tomorrow",tt,card)}>
                          <div style={{fontSize:13,fontWeight:700,color:"#fcd34d"}}>{card.unit}</div>
                          {card.note&&<div style={{fontSize:9,color:"#92400e",marginTop:1}}>{card.note}</div>}
                          {card.hold?<span className="hold-badge">🔴 HOLD</span>:<span style={{fontSize:8,color:"#78350f",display:"inline-block",marginTop:2}}>available</span>}
                          <div style={{marginTop:4}} onClick={e=>e.stopPropagation()}>
                            <label className="tog">
                              <input type="checkbox" checked={!!card.hold} onChange={()=>toggleHold(tt,card.id)}/>
                              <span style={{fontSize:9,color:"#92400e"}}>Hold for reso</span>
                            </label>
                          </div>
                          <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,tomorrow:{...s.tomorrow,[tt]:s.tomorrow[tt].filter(c=>c.id!==card.id)}}));}}>✕</button>
                        </div>
                      ))}
                      <div className="add-btn" style={{borderColor:"#78350f",color:"#78350f"}} onClick={()=>openModal("tomorrow",tt)}>+</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── SERVICE / SHOP ── */}
            {(() => {
              const serviceUnits = TRUCK_TYPES.flatMap(tt =>
                (S.yard[tt]||[]).filter(c=>c.line==="SL"||c.line==="SHOP").map(c=>({...c,tt})) // SRL excluded — it's ready
              );
              if(serviceUnits.length===0) return null;
              return (
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:8,marginBottom:8}}>
                    <div>
                      <div className="section-title" style={{color:"#f87171"}}>🔧 SUB & DEAD — SERVICE PROGRESS</div>
                      <div className="section-sub">SL = Service Line · SHOP = In shop/deadline · set ready date · mark done when fixed</div>
                    </div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#f87171"}}>{serviceUnits.length} unit{serviceUnits.length!==1?"s":""}</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {serviceUnits.map(card=>{
                      const ls=card.line==="SHOP"?LINE.SHOP:LINE.SL;
                      const daysLeft=card.shopDate?daysUntil(card.shopDate):null;
                      const overdue=daysLeft!==null&&daysLeft<0;
                      const today=daysLeft===0;
                      return (
                        <div key={card.id} style={{background:"#ffffff",border:`1px solid ${overdue?"#ef4444":today?"#f59e0b":card.line==="SHOP"?"#e8b4bc":"#7f1d1d"}`,borderRadius:9,padding:"12px 14px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                          {/* Line badge */}
                          <div style={{background:ls.bg,color:ls.text,borderRadius:5,padding:"3px 10px",fontSize:11,fontWeight:700,flexShrink:0}}>{card.line}</div>
                          {/* Unit + truck type */}
                          <div>
                            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:card.line==="SHOP"?"#6b4c52":"#f87171"}}>{card.unit}</div>
                            <div style={{fontSize:9,color:"#9c6b75"}}>{card.tt}</div>
                          </div>
                          {/* Note */}
                          {card.note&&<div style={{fontSize:11,color:"#7a5560",flex:1}}>{card.note}</div>}
                          {/* Ready date picker */}
                          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                            <span style={{fontSize:10,color:"#9c6b75"}}>Ready date:</span>
                            <input
                              type="date"
                              value={card.shopDate||""}
                              onChange={e=>{
                                const val=e.target.value;
                                setS(s=>({...s,yard:{...s.yard,[card.tt]:s.yard[card.tt].map(c=>c.id===card.id?{...c,shopDate:val}:c)}}));
                              }}
                              onClick={e=>e.stopPropagation()}
                              style={{background:"#f3c0c8",border:"1px solid #374151",color:"#1a1a2e",borderRadius:5,padding:"4px 8px",fontFamily:"inherit",fontSize:11,outline:"none"}}
                            />
                          </div>
                          {/* Countdown */}
                          {daysLeft!==null&&(
                            <div style={{background:overdue?"#7f1d1d":today?"#78350f":"#f3c0c8",color:overdue?"#fca5a5":today?"#f59e0b":"#a07880",borderRadius:5,padding:"3px 10px",fontSize:11,fontWeight:700,flexShrink:0}}>
                              {overdue?`${Math.abs(daysLeft)}d overdue`:today?"Ready TODAY":`${daysLeft}d left`}
                            </div>
                          )}
                          {/* Mark fixed — moves to RL */}
                          <button
                            onClick={()=>{
                              setS(s=>({...s,yard:{...s.yard,[card.tt]:s.yard[card.tt].map(c=>c.id===card.id?{...c,line:"SRL",note:"Fixed — Service Ready",shopDate:""}:c)}}));
                              notify(`Unit ${card.unit} marked fixed — moved to SRL ✓`);
                            }}
                            style={{background:"#1e293b",border:"1px solid #94a3b8",color:"#f1f5f9",borderRadius:5,padding:"4px 10px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                            ✓ Fixed → SRL
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── PUROLATOR ── */}
            {(() => {
              const puroUnits = TRUCK_TYPES.flatMap(tt =>
                (S.yard[tt]||[]).filter(c=>c.isPuro).map(c=>({...c,tt}))
              );
              const puroReso = TRUCK_TYPES.flatMap(tt =>
                (S.reso[tt]||[]).filter(c=>c.customer&&c.customer.toUpperCase().includes("PURO")).map(c=>({...c,tt}))
              );
              if(puroUnits.length===0&&puroReso.length===0) return null;
              return (
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:8,marginBottom:8}}>
                    <div>
                      <div className="section-title" style={{color:"#a855f7"}}>🟣 PUROLATOR UNITS</div>
                      <div className="section-sub">All Purolator units on yard + in reso at a glance</div>
                    </div>
                    <div style={{display:"flex",gap:12}}>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#a855f7"}}>{puroUnits.length}</div>
                        <div style={{fontSize:9,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.06em"}}>On Yard</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#7dd3fc"}}>{puroReso.length}</div>
                        <div style={{fontSize:9,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.06em"}}>In Reso</div>
                      </div>
                    </div>
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                    {puroUnits.map(card=>(
                      <div key={card.id} style={{background:"#fce7ef",border:"1px solid #7c3aed",borderRadius:8,padding:"10px 14px",minWidth:140}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:"#a855f7"}}/>
                          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#c4b5fd"}}>{card.unit}</span>
                        </div>
                        <div style={{fontSize:9,color:"#6b21a8"}}>{card.tt}</div>
                        <div style={{fontSize:9,color:"#7c3aed",marginTop:2}}>{card.line} · On Yard</div>
                        {card.note&&<div style={{fontSize:9,color:"#9c6b75",marginTop:2}}>{card.note}</div>}
                      </div>
                    ))}
                    {puroReso.map(card=>(
                      <div key={card.id} style={{background:"#0f0a1e",border:"1px solid #4c1d95",borderRadius:8,padding:"10px 14px",minWidth:140,opacity:0.85}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:"#7c3aed"}}/>
                          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#a78bfa"}}>{card.unit}</span>
                        </div>
                        <div style={{fontSize:9,color:"#6b21a8"}}>{card.tt}</div>
                        <div style={{fontSize:9,color:"#7c3aed",marginTop:2}}>In Reso · back {fmtDate(card.returnDate)}</div>
                        {card.customer&&<div style={{fontSize:9,color:"#9c6b75",marginTop:2}}>{card.customer}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

          </div>
        )}

        {/* ══ PM ══ */}
        {tab==="pm"&&(
          <PMTab S={S} setS={setS_} notify={notify} openModal={openModal}/>
        )}

                {/* ══ GROUND UNITS ══ */}
        {tab==="ground"&&(
          <GroundUnitsTab S={S} setS={setS_} notify={notify} TRUCK_TYPES={TRUCK_TYPES}/>
        )}

        {/* ══ PUROLATOR FLEET SHEET ══ */}
        {tab==="puro"&&(
          <PuroFleetTab S={S} setS={setS_} notify={notify}/>
        )}

        {/* ══ HIKES ══ */}
        {tab==="hikes"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div><div className="section-title" style={{color:"#67e8f9"}}>HIKE TRACKER</div><div className="section-sub">↓ Inbound = coming to you · ↑ Outbound = sent out</div></div>
              <button className="btn btn-amber btn-sm" onClick={()=>openModal("hike")}>+ Add Hike</button>
            </div>
            {S.hikes.length===0&&<div style={{color:"#e8b4bc",fontSize:12,padding:"24px 0",textAlign:"center"}}>No hikes tracked</div>}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
              {S.hikes.map(h=>(
                <div key={h.id} className={`hike-card ${h.dir==="in"?"hike-in":"hike-out"}`}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <span style={{fontSize:15,fontWeight:700,color:h.dir==="in"?"#4ade80":"#c084fc"}}>{h.unit}</span>
                      <span style={{fontSize:9,marginLeft:6,color:h.dir==="in"?"#166534":"#6b21a8",background:h.dir==="in"?"#d1fae511":"#f3e8ff11",padding:"1px 5px",borderRadius:3}}>{h.dir==="in"?"↓ IN":"↑ OUT"}</span>
                    </div>
                    <button className="xcbtn" style={{position:"static"}} onClick={()=>setS(s=>({...s,hikes:s.hikes.filter(x=>x.id!==h.id)}))}>✕</button>
                  </div>
                  <div style={{fontSize:9,color:"#7a5560",marginTop:3}}>{h.tt}</div>
                  {h.location&&<div style={{fontSize:10,color:"#6b4c52",marginTop:2}}>{h.dir==="in"?"From":"To"}: {h.location}</div>}
                  {h.arrival&&<div style={{fontSize:10,color:"#f59e0b",marginTop:2}}>📅 {fmtDate(h.arrival)}</div>}
                  {h.note&&<div style={{fontSize:9,color:"#9c6b75",marginTop:3}}>{h.note}</div>}
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                    {[["placed","Hike Placed","#4ade80"],["ready","Unit Ready","#7dd3fc"],["pmDue","PM Due","#fb923c"]].map(([f,l,c])=>(
                      <label key={f} className="tog">
                        <input type="checkbox" checked={!!h[f]} onChange={()=>toggleHikeField(h.id,f)}/>
                        <span style={{fontSize:10,color:h[f]?c:"#a07880",fontWeight:h[f]?"600":"400"}}>{l}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ SENT & CI ══ */}
        {tab==="other"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,maxWidth:800}}>
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div><div className="section-title" style={{fontSize:17,color:"#a78bfa"}}>NON-REV'D UNITS</div><div className="section-sub">Sent to other locations</div></div>
                <button className="btn btn-amber btn-sm" onClick={()=>openModal("sent")}>+ Add</button>
              </div>
              {S.sent.length===0&&<div style={{color:"#e8b4bc",fontSize:12,padding:"20px 0",textAlign:"center"}}>None sent out</div>}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {S.sent.map(card=>(
                  <div key={card.id} className="side-card" onClick={()=>openModal("sent",null,card)}>
                    <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,fontWeight:700,color:"#a78bfa"}}>{card.unit}</span><span style={{fontSize:9,color:"#7a5560"}}>{card.tt}</span></div>
                    {card.location&&<div style={{fontSize:10,color:"#7c3aed",marginTop:2}}>→ {card.location}</div>}
                    {card.note&&<div style={{fontSize:9,color:"#9c6b75",marginTop:2}}>{card.note}</div>}
                    <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,sent:s.sent.filter(c=>c.id!==card.id)}));}}>✕</button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div><div className="section-title" style={{fontSize:17,color:"#34d399"}}>CHECK IN'S</div><div className="section-sub">Off contract — auto-added via CI action</div></div>
                <button className="btn btn-amber btn-sm" onClick={()=>openModal("checkin")}>+ Add</button>
              </div>
              {S.checkins.length===0&&<div style={{color:"#e8b4bc",fontSize:12,padding:"20px 0",textAlign:"center"}}>No check-ins</div>}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {S.checkins.map(card=>(
                  <div key={card.id} className="side-card" style={{borderColor:"#064e3b"}} onClick={()=>openModal("checkin",null,card)}>
                    <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,fontWeight:700,color:"#34d399"}}>{card.unit}</span><span style={{fontSize:9,color:"#7a5560"}}>{card.tt}</span></div>
                    {(card.hikedFrom||card.customer)&&<div style={{fontSize:10,color:"#059669",marginTop:2}}>✈️ From: {card.hikedFrom||card.customer}</div>}
                    {card.note&&<div style={{fontSize:9,color:"#9c6b75",marginTop:2}}>{card.note}</div>}
                    <button className="xcbtn" onClick={e=>{e.stopPropagation();setS(s=>({...s,checkins:s.checkins.filter(c=>c.id!==card.id)}));}}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══ TASKS ══ */}
        {tab==="tasks"&&(
          <div style={{maxWidth:600}}>
            <div className="section-title" style={{color:"#a3e635",marginBottom:4}}>DAILY TASKS</div>
            <div className="section-sub">Return reminders auto-appear · check-ins auto-added via CI action</div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <input placeholder="Add a task..." value={taskInput} onChange={e=>setTaskInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){addTask(taskInput);setTaskInput("");}}}/>
              <button className="btn btn-amber" style={{flexShrink:0,padding:"8px 14px"}} onClick={()=>{addTask(taskInput);setTaskInput("");}}>Add</button>
            </div>
            {S.tasks.length===0&&<div style={{color:"#e8b4bc",fontSize:12,padding:"20px 0",textAlign:"center"}}>No tasks yet</div>}
            {[["overdue","🚨 Overdue Units","#ef4444"],["return","⚠️ Return Reminders","#f59e0b"],["pm","🔧 PM Reminders","#fb923c"],["pm-swap","🔄 Swap Checks","#f59e0b"],["checkin","✅ Check In Tasks","#34d399"],["general","General","#a07880"]].map(([type,label,color])=>{
              const group=S.tasks.filter(t=>t.type===type);
              if(group.length===0) return null;
              return (
                <div key={type} style={{marginBottom:16}}>
                  <div style={{fontSize:10,color,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{label}</div>
                  {group.map(t=>(
                    <div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 0",borderBottom:"1px solid #1f2937"}}>
                      <input type="checkbox" className="chk-box" checked={t.done} onChange={()=>toggleTask(t.id)}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,color:t.done?"#e8b4bc":"#1a1a2e",textDecoration:t.done?"line-through":"none"}}>
                          {t.unit&&<span style={{color:"#f59e0b",marginRight:5,fontWeight:700}}>#{t.unit}</span>}
                          {t.text}
                        </div>
                      </div>
                      <button style={{background:"none",border:"none",color:"#e8b4bc",cursor:"pointer",fontSize:11}} onClick={()=>delTask(t.id)}>✕</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* ══ WENT OUT MODAL ══ */}
      {goModal&&(
        <div className="overlay" onClick={()=>setGoModal(null)}>
          <div className="modal" style={{background:"#fff7ed",border:"1px solid #f97316",maxWidth:360}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#f97316",marginBottom:4}}>WENT OUT — #{goModal.card.unit}</div>
            <div style={{fontSize:10,color:"#92400e",marginBottom:16}}>{goModal.tt} · unit left the yard · will move to Short Term Reso</div>
            <div className="field"><label>Customer</label><input placeholder="Customer name" value={goForm.customer} onChange={e=>setGoForm(f=>({...f,customer:e.target.value}))}/></div>
            <div className="field">
              <label>Return Date <span style={{color:"#78350f"}}>(default 2 weeks)</span></label>
              <input type="date" value={goForm.returnDate} onChange={e=>setGoForm(f=>({...f,returnDate:e.target.value}))}/>
            </div>
            <div style={{background:"#fdf2f4",borderRadius:6,padding:"8px 10px",fontSize:10,color:"#9c6b75",marginBottom:14}}>
              Unit removed from yard · added to Short Term Reso · return reminder auto-added on due date
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn btn-ghost" onClick={()=>setGoModal(null)}>Cancel</button>
              <button className="btn" style={{background:"#ea580c",color:"#fff7ed"}} onClick={confirmWentOut}>Confirm Went Out</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MAIN MODAL ══ */}
      {modal&&(
        <div className="overlay" onClick={closeModal}>
          <div className="modal" onClick={e=>e.stopPropagation()}>

            {modal.type==="yard"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#f59e0b",marginBottom:14}}>{modal.card?"EDIT":"ADD"} UNIT — {modal.tt}</div>
              <div className="row2">
                <div className="field"><label>Unit #</label><input placeholder="e.g. 529835" value={form.unit||""} onChange={sf("unit")}/></div>
                <div className="field"><label>Line</label>
                  <select value={form.line||"RL"} onChange={sf("line")}>
                    <option value="RL">RL – Ready Line</option>
                    <option value="WL">WL – Wash Line</option>
                    <option value="SRL">SRL – Service Ready Line</option>
                    <option value="SL">SL – Service Line</option>
                    <option value="SHOP">SHOP – Shop/Deadline</option>
                  </select>
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                {[["isPuro","Purolator unit","#a855f7"],["addTomorrow","📅 Need Tomorrow","#fcd34d"],["addPM","🔧 PM Due","#fb923c"],["addCheckin","✅ Check In","#34d399"]].map(([k,l,c])=>(
                  <label key={k} className="tog" style={{background:"#ffffff",border:"1px solid #f3c0c8",borderRadius:6,padding:"6px 10px",cursor:"pointer"}}>
                    <input type="checkbox" checked={!!form[k]} onChange={sf(k)}/>
                    <span style={{fontSize:11,color:form[k]?c:"#a07880"}}>{l}</span>
                  </label>
                ))}
              </div>
              {/* Hike actions — mutually exclusive */}
              <div style={{marginBottom:12}}>
                <div style={{fontSize:10,color:"#9c6b75",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>Hike</div>
                <div style={{display:"flex",gap:8}}>
                  <label className="tog" style={{flex:1,background:form.hikeOut?"#f5d0fe":"#ffffff",border:`1px solid ${form.hikeOut?"#7c3aed":"#f3c0c8"}`,borderRadius:6,padding:"8px 10px",cursor:"pointer"}}
                    onClick={()=>setForm(f=>({...f,hikeOut:!f.hikeOut,hikeIn:false}))}>
                    <input type="checkbox" checked={!!form.hikeOut} onChange={()=>{}} style={{accentColor:"#a855f7"}}/>
                    <span style={{fontSize:11,color:form.hikeOut?"#c4b5fd":"#a07880"}}>↑ Hike Out</span>
                  </label>
                  <label className="tog" style={{flex:1,background:form.hikeIn?"#052e16":"#ffffff",border:`1px solid ${form.hikeIn?"#16a34a":"#f3c0c8"}`,borderRadius:6,padding:"8px 10px",cursor:"pointer"}}
                    onClick={()=>setForm(f=>({...f,hikeIn:!f.hikeIn,hikeOut:false}))}>
                    <input type="checkbox" checked={!!form.hikeIn} onChange={()=>{}} style={{accentColor:"#4ade80"}}/>
                    <span style={{fontSize:11,color:form.hikeIn?"#86efac":"#a07880"}}>↓ Hike In</span>
                  </label>
                </div>
                {form.hikeOut&&<div style={{fontSize:10,color:"#a855f7",marginTop:5,padding:"5px 8px",background:"#fce7ef",borderRadius:5}}>Unit will be removed from yard and added to Hikes ↑ outbound</div>}
                {form.hikeIn&&<div style={{fontSize:10,color:"#4ade80",marginTop:5,padding:"5px 8px",background:"#f0fff4",borderRadius:5}}>Unit will stay on yard as Awaiting Arrival and added to Hikes ↓ inbound</div>}
              </div>
              {form.line==="SHOP"&&<div className="field"><label>Expected Out</label><input type="date" value={form.shopDate||""} onChange={sf("shopDate")}/></div>}
              <div className="field"><label>Note</label><textarea placeholder="Any notes..." value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveYard}>{modal.card?"Save":"Add Unit"}</button>
              </div>
            </>}

            {modal.type==="reso"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#93c5fd",marginBottom:14}}>{modal.card?"EDIT":"ADD"} RESO — {modal.tt}</div>
              <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
              <div className="field"><label>Customer</label><input value={form.customer||""} onChange={sf("customer")}/></div>
              <div className="field"><label>Return Date</label><input type="date" value={form.returnDate||""} onChange={sf("returnDate")}/></div>
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveReso}>{modal.card?"Save":"Add"}</button>
              </div>
            </>}

            {modal.type==="tomorrow"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#fcd34d",marginBottom:14}}>{modal.card?"EDIT":"ADD"} TOMORROW — {modal.tt}</div>
              <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
              <label className="tog" style={{marginBottom:12,display:"flex"}}>
                <input type="checkbox" checked={!!form.hold} onChange={sf("hold")}/>
                <span style={{fontSize:12,color:"#fca5a5"}}>🔴 Hold — do not give out</span>
              </label>
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveTomorrow}>{modal.card?"Save":"Add"}</button>
              </div>
            </>}

            {modal.type==="pm"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#fb923c",marginBottom:14}}>{modal.card?"EDIT":"SCHEDULE"} PM</div>
              <div className="row2">
                <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
                <div className="field"><label>Truck Type</label>
                  <select value={form.tt||""} onChange={sf("tt")}>
                    <option value="">Select...</option>
                    {TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label>PM Date</label><input type="date" value={form.pmDate||""} onChange={sf("pmDate")}/></div>
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={savePM}>{modal.card?"Save":"Schedule"}</button>
              </div>
            </>}

            {modal.type==="hike"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#67e8f9",marginBottom:14}}>{modal.card?"EDIT":"ADD"} HIKE</div>
              <div className="row2">
                <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
                <div className="field"><label>Direction</label>
                  <select value={form.dir||"in"} onChange={sf("dir")}>
                    <option value="in">↓ Inbound</option>
                    <option value="out">↑ Outbound</option>
                  </select>
                </div>
              </div>
              <div className="row2">
                <div className="field"><label>Truck Type</label>
                  <select value={form.tt||""} onChange={sf("tt")}>
                    <option value="">Select...</option>
                    {TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field"><label>{form.dir==="out"?"To":"From"} Location</label><input value={form.location||""} onChange={sf("location")}/></div>
              </div>
              <div className="field"><label>Expected Date</label><input type="date" value={form.arrival||""} onChange={sf("arrival")}/></div>
              <div style={{display:"flex",gap:12,marginBottom:10,flexWrap:"wrap"}}>
                {[["placed","Hike Placed"],["ready","Unit Ready"],["pmDue","PM Due"]].map(([k,l])=>(
                  <label key={k} className="tog">
                    <input type="checkbox" checked={!!form[k]} onChange={sf(k)}/>
                    <span style={{fontSize:12,color:"#6b4c52"}}>{l}</span>
                  </label>
                ))}
              </div>
              {form.pmDue&&<div style={{fontSize:10,color:"#fb923c",marginBottom:10,background:"#fffbeb",borderRadius:5,padding:"6px 10px"}}>⚠️ PM Due auto-adds to PM Schedule</div>}
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveHike}>{modal.card?"Save":"Add Hike"}</button>
              </div>
            </>}

            {modal.type==="sent"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#a78bfa",marginBottom:14}}>{modal.card?"EDIT":"ADD"} NON-REV'D</div>
              <div className="row2">
                <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
                <div className="field"><label>Truck Type</label>
                  <select value={form.tt||""} onChange={sf("tt")}>
                    <option value="">Select...</option>
                    {TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label>Sent To</label><input value={form.location||""} onChange={sf("location")}/></div>
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveSent}>{modal.card?"Save":"Add"}</button>
              </div>
            </>}

            {modal.type==="checkin"&&<>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:"#34d399",marginBottom:14}}>{modal.card?"EDIT":"ADD"} CHECK IN</div>
              <div className="row2">
                <div className="field"><label>Unit #</label><input value={form.unit||""} onChange={sf("unit")}/></div>
                <div className="field"><label>Truck Type</label>
                  <select value={form.tt||""} onChange={sf("tt")}>
                    <option value="">Select...</option>
                    {TRUCK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label>Hiked From</label><input placeholder="e.g. Concord" value={form.customer||""} onChange={sf("customer")}/></div>
              <div className="field"><label>Note</label><textarea value={form.note||""} onChange={sf("note")}/></div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn btn-amber" onClick={saveCheckin}>{modal.card?"Save":"Add"}</button>
              </div>
            </>}

          </div>
        </div>
      )}

      {/* ══ HIKE IN SOURCE MODAL ══ */}
      {hikeInModal&&(
        <div className="overlay" onClick={()=>setHikeInModal(null)}>
          <div className="modal" style={{background:"#f0fff4",border:"1px solid #16a34a",maxWidth:340}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#4ade80",marginBottom:4}}>HIKE IN — #{hikeInModal.card.unit}</div>
            <div style={{fontSize:10,color:"#166534",marginBottom:14}}>{hikeInModal.tt} · where is this unit coming from?</div>
            <div className="field">
              <label>Coming From</label>
              <input
                placeholder="e.g. Concord, Belfield..."
                value={hikeInFrom}
                onChange={e=>setHikeInFrom(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&confirmHikeIn()}
                autoFocus
              />
            </div>
            <div style={{fontSize:10,color:"#9c6b75",marginBottom:14,padding:"6px 8px",background:"#fdf2f4",borderRadius:5}}>
              Unit stays on yard as Awaiting Arrival · added to Hikes ↓ inbound
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn btn-ghost" onClick={()=>setHikeInModal(null)}>Cancel</button>
              <button className="btn" style={{background:"#16a34a",color:"#f0fdf4"}} onClick={confirmHikeIn}>Confirm Hike In</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ HIKE OUT DESTINATION MODAL ══ */}
      {hikeOutModal&&(
        <div className="overlay" onClick={()=>setHikeOutModal(null)}>
          <div className="modal" style={{background:"#fff0f6",border:"1px solid #7c3aed",maxWidth:340}} onClick={e=>e.stopPropagation()}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#c4b5fd",marginBottom:4}}>HIKE OUT — #{hikeOutModal.card.unit}</div>
            <div style={{fontSize:10,color:"#6b21a8",marginBottom:14}}>{hikeOutModal.tt} · where is this unit going?</div>
            <div className="field">
              <label>Destination Location</label>
              <input
                placeholder="e.g. Concord, Belfield..."
                value={hikeOutDest}
                onChange={e=>setHikeOutDest(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&confirmHikeOut()}
                autoFocus
              />
            </div>
            <div style={{fontSize:10,color:"#9c6b75",marginBottom:14,padding:"6px 8px",background:"#fdf2f4",borderRadius:5}}>
              Unit will be removed from yard · added to Hikes ↑ and Sent Out
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn btn-ghost" onClick={()=>setHikeOutModal(null)}>Cancel</button>
              <button className="btn" style={{background:"#7c3aed",color:"#f5f3ff"}} onClick={confirmHikeOut}>Confirm Hike Out</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {notification&&<div className="notif">{notification}</div>}

      {/* ══ HISTORY LIST MODAL ══ */}
      {histOpen&&!historyViewDay&&(
        <div className="overlay" onClick={()=>setHistOpen(false)}>
          <div className="modal" style={{maxWidth:520,maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#f59e0b",letterSpacing:"0.08em"}}>OPERATIONS HISTORY</div>
              <button onClick={()=>setHistOpen(false)} style={{background:"none",border:"none",color:"#9c6b75",cursor:"pointer",fontSize:18}}>✕</button>
            </div>
            {history.length===0&&(
              <div style={{textAlign:"center",padding:"32px 0",color:"#e8b4bc",fontSize:12}}>
                No history yet — hit 🌅 New Day to save today's operations
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[...history].reverse().map(h=>{
                const yardTotal = TRUCK_TYPES.reduce((a,t)=>a+(h.snap.yard[t]||[]).length,0);
                const resoTotal = TRUCK_TYPES.reduce((a,t)=>a+(h.snap.reso[t]||[]).length,0);
                const wentOut   = TRUCK_TYPES.reduce((a,t)=>a+(h.snap.yard[t]||[]).filter(c=>c.wentOut).length,0);
                const tasksDone = (h.snap.tasks||[]).filter(t=>t.done).length;
                const tasksTotal= (h.snap.tasks||[]).length;
                const pmDone    = (h.snap.pmRows||[]).filter(r=>r.status==="done").length;
                return (
                  <div key={h.dayNum} style={{background:"#f3c0c8",border:"1px solid #374151",borderRadius:9,padding:"12px 14px",cursor:"pointer",transition:"border-color 0.15s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="#f59e0b"}
                    onMouseLeave={e=>e.currentTarget.style.borderColor="#e8b4bc"}
                    onClick={()=>{setHistoryViewDay(h);setHistOpen(false);}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#f59e0b"}}>Day {h.dayNum}</div>
                        <div style={{fontSize:11,color:"#7a5560",marginTop:1}}>{h.label}</div>
                      </div>
                      <span style={{fontSize:10,color:"#f59e0b",marginTop:4}}>View →</span>
                    </div>
                    <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
                      {[
                        ["🚛 On Yard", yardTotal, "#7dd3fc"],
                        ["📋 In Reso", resoTotal, "#f59e0b"],
                        ["🚀 Went Out", wentOut, "#f97316"],
                        ["✅ Tasks", `${tasksDone}/${tasksTotal}`, tasksDone===tasksTotal&&tasksTotal>0?"#4ade80":"#a07880"],
                        ["🔧 PM Done", pmDone, "#fb923c"],
                      ].map(([l,v,c])=>(
                        <div key={l} style={{textAlign:"center"}}>
                          <div style={{fontSize:14,fontWeight:700,color:c}}>{v}</div>
                          <div style={{fontSize:9,color:"#9c6b75"}}>{l}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ HISTORY DAY DETAIL MODAL ══ */}
      {historyViewDay&&(
        <div className="overlay" onClick={()=>setHistoryViewDay(null)}>
          <div style={{background:"#fdf2f4",border:"1px solid #f3c0c8",borderRadius:12,width:"100%",maxWidth:980,maxHeight:"92vh",overflowY:"auto",padding:20}} onClick={e=>e.stopPropagation()}>
            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,paddingBottom:12,borderBottom:"1px solid #1f2937"}}>
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#f59e0b",letterSpacing:"0.08em"}}>DAY {historyViewDay.dayNum} — SNAPSHOT</div>
                <div style={{fontSize:11,color:"#9c6b75",marginTop:2}}>{historyViewDay.label} · read-only</div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={()=>{setHistoryViewDay(null);setHistOpen(true);}} style={{background:"#f3c0c8",border:"1px solid #374151",color:"#6b4c52",borderRadius:6,padding:"5px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
                <button onClick={()=>setHistoryViewDay(null)} style={{background:"none",border:"none",color:"#9c6b75",cursor:"pointer",fontSize:18}}>✕</button>
              </div>
            </div>

            {(() => {
              const h = historyViewDay.snap;
              const LINE_H = { RL:{bg:"#84cc16",text:"#1a2e05"}, WL:{bg:"#7dd3fc",text:"#0c2a3e"}, SRL:{bg:"#f1f5f9",text:"#0f172a"}, SL:{bg:"#f87171",text:"#3b0a0a"}, SHOP:{bg:"#e8b4bc",text:"#f9fafb"}, PUR:{bg:"#a855f7",text:"#f5f3ff"} };

              const Section = ({title,color,children}) => (
                <div style={{marginBottom:20}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:color||"#1a1a2e",letterSpacing:"0.06em",marginBottom:8,paddingBottom:4,borderBottom:"1px solid #1f2937"}}>{title}</div>
                  {children}
                </div>
              );

              const yardUnits = TRUCK_TYPES.flatMap(tt=>(h.yard[tt]||[]).map(c=>({...c,tt})));
              const resoUnits = TRUCK_TYPES.flatMap(tt=>(h.reso[tt]||[]).map(c=>({...c,tt})));
              const tomUnits  = TRUCK_TYPES.flatMap(tt=>(h.tomorrow[tt]||[]).map(c=>({...c,tt})));
              const tasks     = h.tasks||[];
              const pmRows    = h.pmRows||[];
              const hikes     = h.hikes||[];
              const sent      = h.sent||[];

              return (
                <div>
                  {/* Yard */}
                  <Section title={`🚛 My Yard (${yardUnits.length} units)`} color="#7dd3fc">
                    {yardUnits.length===0?<div style={{fontSize:11,color:"#e8b4bc"}}>No units on yard</div>:(
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {yardUnits.map(c=>{
                          const ls=c.isPuro?LINE_H.PUR:(LINE_H[c.line]||LINE_H.RL);
                          return (
                            <div key={c.id} style={{background:ls.bg,color:ls.text,borderRadius:6,padding:"5px 10px",fontSize:11}}>
                              <div style={{fontWeight:700}}>{c.unit}</div>
                              <div style={{fontSize:9,opacity:0.75}}>{c.isPuro?"PURO":c.line} · {c.tt}</div>
                              {c.wentOut&&<div style={{fontSize:8,fontWeight:700}}>✅ WENT OUT</div>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Section>

                  {/* Reso */}
                  <Section title={`📋 Short Term Reso (${resoUnits.length} units)`} color="#93c5fd">
                    {resoUnits.length===0?<div style={{fontSize:11,color:"#e8b4bc"}}>No units in reso</div>:(
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {resoUnits.map(c=>(
                          <div key={c.id} style={{background:"#f0f4ff",border:"1px solid #1e3a5f",borderRadius:6,padding:"6px 10px",fontSize:11}}>
                            <div style={{fontWeight:700,color:"#93c5fd"}}>{c.unit}</div>
                            {c.customer&&<div style={{fontSize:9,color:"#7dd3fc"}}>{c.customer}</div>}
                            {c.returnDate&&<div style={{fontSize:9,color:"#f59e0b"}}>Back {fmtDate(c.returnDate)}</div>}
                            <div style={{fontSize:9,color:"#9c6b75"}}>{c.tt}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>

                  {/* Tomorrow */}
                  {tomUnits.length>0&&(
                    <Section title={`📅 Need for Tomorrow (${tomUnits.length})`} color="#fcd34d">
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {tomUnits.map(c=>(
                          <div key={c.id} style={{background:"#fff7e6",border:"1px solid #78350f",borderRadius:6,padding:"5px 10px",fontSize:11}}>
                            <div style={{fontWeight:700,color:"#fcd34d"}}>{c.unit}</div>
                            <div style={{fontSize:9,color:"#92400e"}}>{c.tt}{c.hold?" · 🔴 HOLD":""}</div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Tasks */}
                  <Section title={`✅ Daily Tasks (${tasks.filter(t=>t.done).length}/${tasks.length} done)`} color="#a3e635">
                    {tasks.length===0?<div style={{fontSize:11,color:"#e8b4bc"}}>No tasks</div>:(
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        {tasks.map(t=>(
                          <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:t.done?"#e8b4bc":"#6b4c52",textDecoration:t.done?"line-through":"none"}}>
                            <span style={{fontSize:14}}>{t.done?"✅":"⬜"}</span>
                            {t.unit&&<span style={{color:"#f59e0b",fontWeight:700}}>#{t.unit}</span>}
                            {t.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>

                  {/* PM */}
                  {pmRows.length>0&&(
                    <Section title={`🔧 PM Checklist (${pmRows.filter(r=>r.status==="done").length} done)`} color="#fb923c">
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        {pmRows.map(r=>(
                          <div key={r.id} style={{display:"flex",alignItems:"center",gap:10,fontSize:12,background:"#f3c0c8",borderRadius:5,padding:"6px 10px",opacity:r.status==="done"?0.6:1}}>
                            <span style={{fontSize:13}}>{r.status==="done"?"✅":r.status==="scheduled"?"📅":"⬜"}</span>
                            <span style={{fontWeight:700,color:r.status==="done"?"#4ade80":r.status==="scheduled"?"#34d399":"#fb923c"}}>{r.unit}</span>
                            <span style={{color:"#7a5560",fontSize:10}}>{r.pmType} · {r.customer}</span>
                            {r.scheduledDate&&<span style={{color:"#f59e0b",fontSize:10,marginLeft:"auto"}}>📅 {fmtDate(r.scheduledDate)}</span>}
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Hikes */}
                  {hikes.length>0&&(
                    <Section title={`✈️ Hikes (${hikes.length})`} color="#67e8f9">
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {hikes.map(h=>(
                          <div key={h.id} style={{background:h.dir==="in"?"#0a1f12":"#fff0f6",border:`1px solid ${h.dir==="in"?"#166534":"#6b21a8"}`,borderRadius:6,padding:"5px 10px",fontSize:11}}>
                            <div style={{fontWeight:700,color:h.dir==="in"?"#4ade80":"#c084fc"}}>{h.unit} {h.dir==="in"?"↓":"↑"}</div>
                            <div style={{fontSize:9,color:"#9c6b75"}}>{h.location||"—"}</div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Sent */}
                  {sent.length>0&&(
                    <Section title={`📤 Sent Out (${sent.length})`} color="#a78bfa">
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {sent.map(c=>(
                          <div key={c.id} style={{background:"#f3c0c8",border:"1px solid #374151",borderRadius:6,padding:"5px 10px",fontSize:11}}>
                            <div style={{fontWeight:700,color:"#a78bfa"}}>{c.unit}</div>
                            <div style={{fontSize:9,color:"#7a5560"}}>{c.location||"—"}</div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

    </div>
  );
}

import React from 'react';
import {PlayerSession} from './PlayerSession';
export type AppView='today'|'history'|'progress'|'shop'|'tools'|'rules';
const icons={
 logout:<><path d="M10 4H4v16h6M9 12h12m-4-4 4 4-4 4"/></>,
 today:<><path d="m7 5 14 14m-1-14L6 19M5 16l5 5M16 5l5 5M4 22l3-3m12 0 3 3"/><path d="m7 5-3-1 1 3m15-2 3-1-1 3"/></>,
 history:<><path d="M5 5h7v17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm7 0h7a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-7M6 9h3m-3 4h3m6-4h3m-3 4h3"/></>,
 progress:<><path d="m12 2 8 4v7c0 5-8 9-8 9s-8-4-8-9V6l8-4Z"/><path d="M12 17V8m-4 4 4-4 4 4"/></>,
 shop:<><path d="m7 7-3 5h16l-3-5H7Zm-2 5v9h14v-9M9 7V5a3 3 0 0 1 6 0v2"/><path d="m12 14 2 2-2 2-2-2 2-2Z"/></>,
 more:<><path d="M5 6h14M5 12h14M5 18h14"/><path d="m12 3 2 3-2 3-2-3 2-3Z"/></>,
 tools:<><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></>,
 rules:<><path d="M6 3h12v18H6zM9 7h6m-6 4h6m-6 4h4"/></>,
};
function Icon({name}:{name:keyof typeof icons}){return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{icons[name]}</svg>;}
export function BottomNav({view,onNavigate}:{view:AppView;onNavigate:(view:AppView)=>void}){
 const {signOut,signingOut}=React.useContext(PlayerSession);
 const [logoutError,setLogoutError]=React.useState('');
 const panel=React.useRef<HTMLDivElement>(null),trigger=React.useRef<HTMLButtonElement>(null);
 const [open,setOpen]=React.useState(false);
 function close(){panel.current?.hidePopover();trigger.current?.focus();}
 function navigate(next:AppView){close();onNavigate(next);}
 const items=[{view:'today',label:'Missions'},{view:'history',label:'History'},{view:'progress',label:'Progress'},{view:'shop',label:'Shop'}] as const;
 return <><nav className="bottom-nav" aria-label="Main sections"><div className="bottom-nav-inner">{items.map(item=><button key={item.view} className="bottom-nav-item" aria-current={view===item.view?'page':undefined} onClick={()=>navigate(item.view)}><span className="nav-icon"><Icon name={item.view}/></span><span>{item.label}</span></button>)}<button ref={trigger} className="bottom-nav-item" aria-current={view==='tools'||view==='rules'?'page':undefined} aria-expanded={open} aria-controls="adventure-menu" aria-haspopup="dialog" onClick={()=>panel.current?.togglePopover()}><span className="nav-icon"><Icon name="more"/></span><span>More</span></button></div></nav><div ref={panel} popover="auto" role="dialog" id="adventure-menu" className="adventure-menu" aria-labelledby="adventure-menu-title" onToggle={event=>setOpen(event.newState==='open')}><div className="adventure-menu-content"><div className="menu-heading"><div><span className="menu-kicker">WINTER ARC</span><h2 id="adventure-menu-title">Your camp</h2></div><button className="icon-button" aria-label="Close menu" onClick={close}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div><button className="camp-option" aria-current={view==='tools'?'page':undefined} onClick={()=>navigate('tools')}><Icon name="tools"/><span><strong>Backup and installation</strong><small>Protect your records and take your adventure with you</small></span><span aria-hidden="true">›</span></button><button className="camp-option" aria-current={view==='rules'?'page':undefined} onClick={()=>navigate('rules')}><Icon name="rules"/><span><strong>Season and rules</strong><small>Read the Winter Arc codex</small></span><span aria-hidden="true">›</span></button><button className="camp-option camp-logout" disabled={signingOut} onClick={()=>{setLogoutError('');void signOut().catch(()=>setLogoutError('Could not sign out. Please try again.'));}}><Icon name="logout"/><span><strong>{signingOut?'Signing out…':'Sign out'}</strong><small>Your records stay saved on this device</small></span></button>{logoutError&&<p className="error" role="alert">{logoutError}</p>}<p className="camp-version" aria-label="App version">Winter Arc · v{__APP_VERSION__}</p></div></div></>;
}

import React from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { selectPlayerStorage } from './storage';
import { SyncPanel } from './SyncPanel';
import { PlayerSession } from './PlayerSession';
export function AuthGate({children}:{children:React.ReactNode}){
 const [session,setSession]=React.useState<Session|null>(null),[ready,setReady]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const [cachedPlayer,setCachedPlayer]=React.useState<string|null>(null),[online,setOnline]=React.useState(navigator.onLine);
 const [requestRecovery,setRequestRecovery]=React.useState(false);
 const [recovering,setRecovering]=React.useState(false),[authNotice,setAuthNotice]=React.useState('');
 React.useEffect(()=>{
 let alive=true;
 const recoverOffline=()=>{const id=localStorage.getItem('winter-arc-last-player');if(!navigator.onLine&&id&&/^[a-zA-Z0-9-]+$/.test(id)){selectPlayerStorage(id);setCachedPlayer(id);setReady(true);}};
 const apply=(next:Session|null)=>{if(!alive)return;if(next){selectPlayerStorage(next.user.id);localStorage.setItem('winter-arc-last-player',next.user.id);setCachedPlayer(next.user.id);}else recoverOffline();setSession(next);setReady(true);};
 const connection=()=>{setOnline(navigator.onLine);recoverOffline();if(navigator.onLine)void supabase.auth.getSession().then(({data})=>apply(data.session));};
 window.addEventListener('online',connection);window.addEventListener('offline',connection);recoverOffline();
 const {data:{subscription}}=supabase.auth.onAuthStateChange((event,next)=>{if(event==='PASSWORD_RECOVERY')setRecovering(true);apply(next);});
 void supabase.auth.getSession().then(({data,error})=>{if(error&&alive){recoverOffline();setError('Could not restore your session.');setReady(true);}else apply(data.session);});
 return()=>{alive=false;subscription.unsubscribe();window.removeEventListener('online',connection);window.removeEventListener('offline',connection);};
 },[]);
 if(!ready)return <main><h1>Winter Arc</h1><p role="status">Restoring your session…</p></main>;
 if(recovering&&session)return <LoginFrame><span className="login-eyebrow">RECLAIM YOUR ADVENTURE</span><h1>Choose a new password</h1><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget),password=String(f.get('password'));if(password!==String(f.get('confirm'))){setError('Passwords do not match.');return;}setBusy(true);setError('');try{const {error}=await supabase.auth.updateUser({password});if(error)setError('Could not update your password. Open a valid link and try again while online.');else{setRecovering(false);setAuthNotice('Password updated.');}}catch{setError('Could not connect. Please try again.');}finally{setBusy(false);}}}><label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} required/></label><label>Confirm password<input name="confirm" type="password" autoComplete="new-password" minLength={8} required/></label><button disabled={busy||!online}>Save password</button>{error&&<p role="alert">{error}</p>}</form></LoginFrame>;
 if(!session&&!(cachedPlayer&&!online))return <LoginFrame><span className="login-eyebrow">{requestRecovery?'RECLAIM YOUR ADVENTURE':'WINTER IS YOUR TRIAL'}</span><h1>{requestRecovery?'Recover your access':'Resume your adventure'}</h1><p className="login-intro">{requestRecovery?'Enter your Player email and we will send you a password reset link.':'Every mission counts. Sign in as Player and continue your ascent.'}</p><form onSubmit={async e=>{
 e.preventDefault();if(busy)return;const form=new FormData(e.currentTarget);setBusy(true);setError('');setAuthNotice('');
 try{
  if(requestRecovery){
   const {error}=await supabase.auth.resetPasswordForEmail(String(form.get('email')),{redirectTo:window.location.origin});
   if(error)setError('Could not request a recovery link. Check your connection and try again.');
   else setAuthNotice("If the account exists and email delivery is enabled, you'll receive a link to choose a new password.");
  }else{
   const {error}=await supabase.auth.signInWithPassword({email:String(form.get('email')),password:String(form.get('password'))});
   if(error)setError('Could not sign in. Check your email, password and connection.');
  }
 }catch{setError('Could not connect. Please try again.');}finally{setBusy(false);}
 }}><label>Email<input name="email" type="email" autoComplete="username" required disabled={busy}/></label>{!requestRecovery&&<label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required disabled={busy}/></label>}{error&&<p role="alert" className="error">{error}</p>}<button className="login-submit" disabled={busy||!online}>{requestRecovery?(busy?'Sending recovery link…':'Send recovery link'):(busy?'Opening the portal…':'Enter Winter Arc')}<span aria-hidden="true">→</span></button>{!online&&<p role="status" className="muted">Connect to the internet to {requestRecovery?'recover access':'sign in'}.</p>}</form><button type="button" className="login-mode-toggle" disabled={busy} onClick={()=>{setRequestRecovery(!requestRecovery);setError('');setAuthNotice('');}}>{requestRecovery?'← Back to sign in':'Recover access by email'}</button><p role="status">{authNotice}</p><p className="login-footnote">Your progress begins with a decision.</p></LoginFrame>;
 return <PlayerSession.Provider value={{signingOut:busy,signOut:async()=>{setBusy(true);try{const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error;localStorage.removeItem('winter-arc-last-player');setCachedPlayer(null);setSession(null);}finally{setBusy(false);}}}}><React.Fragment key={session?.user.id||cachedPlayer!}><SyncPanel/>{children}</React.Fragment></PlayerSession.Provider>;
}

function LoginFrame({children}:{children:React.ReactNode}){
 return <main className="login-screen"><div className="login-brand"><div className="login-crest" aria-hidden="true"><svg viewBox="0 0 80 80" fill="none"><path d="m40 3 29 17v40L40 77 11 60V20Z"/><path d="M40 14v52M17 27l46 26M17 53l46-26M31 18l9 9 9-9M31 62l9-9 9 9M20 36l12-3-3-12M60 44l-12 3 3 12M20 44l12 3-3 12M60 36l-12-3 3-12"/></svg></div><span>WINTER ARC</span><small>SEASON 2026</small></div><section className="login-card" aria-label="Player sign-in"><div className="login-card-rune" aria-hidden="true">◆</div>{children}</section><div className="login-season" aria-hidden="true"><span/> DISCIPLINE · EVOLUTION · LEGACY <span/></div></main>;
}

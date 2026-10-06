import React from 'react';
export const PlayerSession=React.createContext<{signOut:()=>Promise<void>;signingOut:boolean}>({signOut:async()=>{},signingOut:false});

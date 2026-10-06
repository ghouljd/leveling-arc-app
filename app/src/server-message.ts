// Older server responses and saved sync results may still contain legacy wording.
// Keep the UI English without changing stored records or requiring a DB migration.
export function serverMessage(message:string|undefined):string|undefined{
 if(!message)return message;
 const legacy:Record<string,string>={
  'La noche flexible de esta semana ya está asignada a otra noche.':"This week's flexible night is already assigned to another night.",
  'Los objetivos efectivos difieren; sincroniza y revisa el cierre.':'The effective targets differ; sync and review the closure.',
  'Cambió un aporte: descarga los registros y revisa el cierre.':'An entry changed: download the records and review the closure.',
  'Cambió una decisión: descarga los registros y revisa el cierre.':'A decision changed: download the records and review the closure.',
  'Registraste cambios después de preparar este cierre. Revisa un cierre nuevo con los datos actuales.':'You recorded changes after preparing this closure. Review a new closure with the current records.',
  'Saldo confirmado insuficiente: necesitas 250 MC.':'Insufficient confirmed balance: you need 250 MC.',
  'Ya alcanzaste el cupo semanal de este ticket.':"You have reached this ticket's weekly limit.",
  'Elige una ocasión futura de la semana seleccionada y dentro de la temporada.':'Choose a future occasion in the selected week and within the season.',
  'Ya tienes un ticket para esa noche.':'You already have a ticket for that night.',
  'Compra rechazada. Revisa los datos e intenta una nueva solicitud.':'Purchase rejected. Check the details and submit a new request.',
 };
 return legacy[message]||message;
}

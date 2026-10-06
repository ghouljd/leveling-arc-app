import React from 'react';

type Props = Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'defaultValue'> & {
 type: 'date' | 'time' | 'datetime-local';
 value?: string;
 defaultValue?: string;
};

// The native input handles validation, keyboard access and the device picker.
// A separate visible value keeps iOS's intrinsic control sizing out of layout.
export function DateInput({type, value, defaultValue = '', onChange, ...props}: Props) {
 const [draft, setDraft] = React.useState(defaultValue);
 const current = value ?? draft;
 const [date, time] = current.split('T');
 const parts = date.split('-');
 const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : date;
 const display = !current ? 'Seleccionar' : type === 'time' ? current :
  type === 'date' ? formattedDate : `${formattedDate} · ${time}`;
 return <span className={`date-control${props.disabled ? ' disabled' : ''}`}>
  <span className="date-control-value" aria-hidden="true">{display}</span>
  <span className="date-control-icon" aria-hidden="true">▦</span>
  <input {...props} type={type} value={current} onChange={event => {
   setDraft(event.currentTarget.value);
   onChange?.(event);
  }}/>
 </span>;
}

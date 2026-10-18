export function calculateCharge(sessions, joinedAt, trialId = null, trialPrice = 0) {
  const remaining = sessions.filter(s => s.starts_at >= joinedAt);
  if (trialId !== null) {
    if (!remaining.some(s => s.id === trialId)) throw new Error('Termin próbny już się rozpoczął lub jest niedostępny.');
    return { amount: trialPrice, count: 1 };
  }
  return { amount: remaining.reduce((sum, s) => sum + s.price, 0), count: remaining.length };
}
export function warsawNow() {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).format(new Date());
  return parts.replace(' ', 'T');
}

export function enrollmentMonth(requestedMonth, now = warsawNow()) {
  const current = now.slice(0, 7);
  if (requestedMonth != null && requestedMonth !== current) {
    throw new Error('Zapis jest możliwy tylko na bieżący miesiąc. Odśwież formularz i spróbuj ponownie.');
  }
  return current;
}

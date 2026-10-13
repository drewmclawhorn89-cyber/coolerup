export function TopTabs() {
  return (
    <div style={{position: 'fixed', top: 0, left: 0, right: 0, height: '50px', background: 'black', zIndex: 9999, display: 'flex', alignItems: 'center', padding: '0 16px', gap: '16px', borderBottom: '1px solid #222'}}>
      <span style={{color: 'white', fontWeight: 'bold', border: '2px solid white', padding: '2px 6px', fontSize: '12px'}}>LIVE</span>
      <span style={{color: 'white', fontWeight: 'bold'}}>For You</span>
      <span style={{color: 'gray'}}>Following</span>
      <span style={{color: 'gray'}}>STEM</span>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'

export default function Messages() {
  const [msgs, setMsgs] = useState<any[]>([])
  const [text, setText] = useState('')
  const [userId, setUserId] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(r => setUserId(r.data.user?.id || ''))
    supabase.from('messages').select('*').order('created_at', {ascending: false}).then(r => setMsgs(r.data || []))
  }, [])

  async function send() {
    if(!text) return
    await supabase.from('messages').insert({ message: text, sender_id: userId })
    setText('')
    location.reload()
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 pb-24">
      <h1 className="text-2xl font-bold mb-4">Messages 💬</h1>
      <div className="flex gap-2 mb-6">
        <input value={text} onChange={e=>setText(e.target.value)} placeholder="Type a message..." className="flex-1 bg-zinc-800 border border-zinc-700 p-3 rounded-xl text-white" />
        <button onClick={send} className="bg-white text-black px-6 rounded-xl font-bold">Send</button>
      </div>
      <div className="space-y-2">
        {msgs.map(m => (
          <div key={m.id} className="bg-zinc-900 p-3 rounded-xl border border-zinc-800">{m.message}</div>
        ))}
        {msgs.length===0 && <p className="text-zinc-500 text-center mt-10">No messages yet. Say hi!</p>}
      </div>
    </div>
  )
}

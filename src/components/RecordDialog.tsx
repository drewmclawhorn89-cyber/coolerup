import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { supabase } from "@/integrations/supabase/client"
import { X, Circle, Square } from "lucide-react"

export function RecordDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (v: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!open) {
      stream?.getTracks().forEach(t => t.stop())
      setStream(null)
      setRecordedBlob(null)
      setRecording(false)
      return
    }
    async function start() {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      setStream(s)
      if (videoRef.current) videoRef.current.srcObject = s
    }
    start()
  }, [open])

  const startRecording = () => {
    if (!stream) return
    const chunks: Blob[] = []
    const mr = new MediaRecorder(stream)
    mediaRecorderRef.current = mr
    mr.ondataavailable = e => chunks.push(e.data)
    mr.onstop = () => setRecordedBlob(new Blob(chunks, { type: "video/webm" }))
    mr.start()
    setRecording(true)
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  const upload = async () => {
    if (!recordedBlob) return
    setUploading(true)
    const fileName = `recorded-${Date.now()}.webm`
    const { error } = await supabase.storage.from("videos").upload(fileName, recordedBlob)
    setUploading(false)
    if (error) alert(error.message)
    else {
      alert("Uploaded!")
      onOpenChange(false)
      window.location.reload()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black text-white border-0 max-w- p-0 overflow-hidden">
        <DialogHeader className="p-4">
          <DialogTitle>Record</DialogTitle>
        </DialogHeader>
        <div className="relative bg-black aspect-[9/16]">
          {!recordedBlob ? (
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          ) : (
            <video src={URL.createObjectURL(recordedBlob)} controls autoPlay className="h-full w-full" />
          )}
        </div>
        <div className="flex justify-center gap-4 p-4">
          {!recordedBlob ? (
            !recording ? (
              <Button onClick={startRecording} size="icon" className="h-16 w-16 rounded-full bg-red-500"><Circle className="fill-white" /></Button>
            ) : (
              <Button onClick={stopRecording} size="icon" className="h-16 w-16 rounded-full bg-white text-black"><Square /></Button>
            )
          ) : (
            <>
              <Button variant="ghost" onClick={() => setRecordedBlob(null)}><X /> Retake</Button>
              <Button onClick={upload} disabled={uploading} className="bg-white text-black">{uploading ? "Uploading..." : "Post"}</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

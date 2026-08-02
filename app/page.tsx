import { VideoWall } from './components/VideoWall'

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950">
      <header className="border-b border-neutral-800 px-4 py-3">
        <h1 className="text-lg font-semibold text-white">BroadwayVideoWall</h1>
      </header>
      <VideoWall />
    </main>
  )
}

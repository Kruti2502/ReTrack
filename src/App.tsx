import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { RequireAuth, RequireRole } from '@/components/RouteGuards'
import Login from '@/pages/Login'
import TodaysMission from '@/pages/TodaysMission'
import ActivityDetail from '@/pages/ActivityDetail'
import Journey from '@/pages/Journey'
import History from '@/pages/History'
import DayDetail from '@/pages/DayDetail'
import Gallery from '@/pages/Gallery'
import Profile from '@/pages/Profile'
import KrutiDashboard from '@/pages/kruti/KrutiDashboard'
import KrutiReview from '@/pages/kruti/KrutiReview'
import ManagePlan from '@/pages/kruti/ManagePlan'
import KrutiSettings from '@/pages/kruti/KrutiSettings'
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          {/* Shared by both — Kruti sees the activity read-only. */}
          <Route path="/journey" element={<Journey />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:date" element={<DayDetail />} />
          <Route path="/photos" element={<Gallery />} />
          <Route path="/activity/:activityId" element={<ActivityDetail />} />

          {/* Dharmik */}
          <Route element={<RequireRole role="DHARMIK" />}>
            <Route path="/" element={<TodaysMission />} />
            <Route path="/profile" element={<Profile />} />
          </Route>

          {/* Kruti */}
          <Route element={<RequireRole role="KRUTI" />}>
            <Route path="/kruti" element={<KrutiDashboard />} />
            <Route path="/kruti/review" element={<KrutiReview />} />
            <Route path="/kruti/plan" element={<ManagePlan />} />
            <Route path="/kruti/settings" element={<KrutiSettings />} />
          </Route>
        </Route>
      </Route>

      <Route path="/index.html" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

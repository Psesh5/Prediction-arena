import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import FeedPage from "./pages/FeedPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import MarketPage from "./pages/MarketPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<FeedPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/markets/:marketId" element={<MarketPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

import { BrowserRouter, Routes, Route } from "react-router-dom";

import { AnalysisProvider } from "./context/AnalysisContext";
import { ThemeProvider } from "./context/ThemeContext";
import Home from "./pages/Home";
import Board from "./pages/Board";
import DebugCenter from "./pages/DebugCenter";
import Commits from "./pages/Commits";
import Contributors from "./pages/Contributors";
import Hotspots from "./pages/Hotspots";
import Timeline from "./pages/Timeline";
import AIInsights from "./pages/AIInsights";
import Setting from "./pages/Setting";

import Login from "./pages/Login";
import Register from "./pages/Register";

import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./Layout/AppLayout";

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AnalysisProvider>
          <Routes>
            {/* Public Pages */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Protected Pages */}
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Board />} />
              <Route path="/debug-center" element={<DebugCenter />} />
              <Route path="/commits" element={<Commits />} />
              <Route path="/contributors" element={<Contributors />} />
              <Route path="/hotspots" element={<Hotspots />} />
              <Route path="/timeline" element={<Timeline />} />
              <Route path="/ai-insights" element={<AIInsights />} />
              <Route path="/settings" element={<Setting />} />
            </Route>
          </Routes>
        </AnalysisProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
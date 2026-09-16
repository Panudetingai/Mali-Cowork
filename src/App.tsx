import { AppLayout } from "@/layouts/app-layout";
import { Navigate, Route, Routes } from "react-router-dom";
import ChatLayout from "./pages/chat/layout";

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route
          index
          element={
            <ChatLayout />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;

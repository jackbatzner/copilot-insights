import { createContext, useContext, useState } from "react";

const DevPlanContext = createContext(null);

export function DevPlanProvider({ children }) {
  const [addedGoals, setAddedGoals] = useState(new Set());
  const [addingGoal, setAddingGoal] = useState(null);

  return (
    <DevPlanContext.Provider value={{ addedGoals, setAddedGoals, addingGoal, setAddingGoal }}>
      {children}
    </DevPlanContext.Provider>
  );
}

export function useDevPlan() {
  const ctx = useContext(DevPlanContext);
  if (!ctx) throw new Error("useDevPlan must be used inside DevPlanProvider");
  return ctx;
}

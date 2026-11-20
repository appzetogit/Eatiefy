import { useNavigate } from "react-router-dom"
import FeedbackBottomSheet from "@food/components/common/FeedbackBottomSheet"

export default function UserFeedbackExperience() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#121212]">
      <FeedbackBottomSheet
        isOpen={true}
        onClose={() => navigate(-1)}
        module="user"
        title="Share Feedback"
      />
    </div>
  )
}

import useDeliveryBackNavigation from '../../hooks/useDeliveryBackNavigation';
import FeedbackBottomSheet from '@food/components/common/FeedbackBottomSheet';

export default function DeliveryFeedbackV2() {
  const goBack = useDeliveryBackNavigation();

  return (
    <div className="min-h-screen bg-gray-50">
      <FeedbackBottomSheet
        isOpen={true}
        onClose={goBack}
        module="delivery"
        title="Delivery App Experience"
      />
    </div>
  );
}

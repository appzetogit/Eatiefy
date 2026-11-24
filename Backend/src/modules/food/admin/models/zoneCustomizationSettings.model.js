import mongoose from 'mongoose';

/**
 * Zone-level overrides for the admin "Customization Settings" toggles that are
 * safe to vary by zone (COD / wallet / online payment switches).
 *
 * One document per zone. `overrides` only holds the keys the zone changes
 * ({ cod_enabled: false, ... }); a key that is absent follows the platform-wide
 * value stored in FoodSystemConfig, so a zone with no document behaves exactly
 * like the global setting.
 */
const zoneCustomizationSettingsSchema = new mongoose.Schema(
    {
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            required: true,
            unique: true,
        },
        overrides: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        updatedBy: {
            role: { type: String },
            adminId: { type: mongoose.Schema.Types.ObjectId },
            at: { type: Date, default: Date.now },
        },
    },
    { collection: 'food_zone_customization_settings', timestamps: true, minimize: false }
);

export const FoodZoneCustomizationSettings = mongoose.model(
    'FoodZoneCustomizationSettings',
    zoneCustomizationSettingsSchema
);

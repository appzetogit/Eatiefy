import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Eye, Edit2, Loader2, Camera, X, Plus, FileText, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';
import { openCamera, openGallery, ensureUploadableImageFile } from "@food/utils/imageUploadUtils";
import { getUserFacingApiError } from "@/shared/utils/apiError";
import { prepareUploadFile } from "@/shared/utils/imageCompressor";
import useDeliveryBackNavigation from '../../hooks/useDeliveryBackNavigation';

/**
 * ProfileDocsV2 - Restored Old UI for Registration Documents & Vehicle Info.
 */
export const ProfileDocsV2 = () => {
  const goBack = useDeliveryBackNavigation();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // field -> upload progress (0-100) while that document is uploading
  const [uploadingDocs, setUploadingDocs] = useState({});
  // field -> { message, file } for a failed upload that can be retried
  const [failedUploads, setFailedUploads] = useState({});
  const [showViewer, setShowViewer] = useState(null); // { title: string, url: string }
  const [uploadField, setUploadField] = useState(null)
  const fileInputRef = useRef(null);

  const viewerHistoryPushedRef = useRef(false);
  const isClosingViaHistoryBackRef = useRef(false);

  useEffect(() => {
    if (showViewer) {
      if (!viewerHistoryPushedRef.current) {
        window.history.pushState({ docViewerOpen: true }, "");
        viewerHistoryPushedRef.current = true;
      }

      const handlePopState = () => {
        if (isClosingViaHistoryBackRef.current) {
          isClosingViaHistoryBackRef.current = false;
          viewerHistoryPushedRef.current = false;
          return;
        }
        viewerHistoryPushedRef.current = false;
        setShowViewer(null);
      };

      window.addEventListener("popstate", handlePopState);
      return () => {
        window.removeEventListener("popstate", handlePopState);
      };
    } else {
      viewerHistoryPushedRef.current = false;
    }
  }, [showViewer]);

  const closeViewer = () => {
    setShowViewer(null);
    if (viewerHistoryPushedRef.current) {
      isClosingViaHistoryBackRef.current = true;
      viewerHistoryPushedRef.current = false;
      window.history.back();
    }
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await deliveryAPI.getProfile();
        if (response?.data?.success) setProfile(response.data.data.profile);
      } catch (e) { toast.error("Failed to load documents"); }
      finally { setLoading(false); }
    };
    fetchProfile();
  }, []);

  /*
   * Uploads one document photo to server storage and reloads the profile from the
   * API, so what is shown is what the database now holds. The backend previously
   * saved only the profile photo from this endpoint, so these uploads "succeeded"
   * but disappeared on refresh.
   */
  const handleUpdate = async (field, pickedFile) => {
     if (!pickedFile) return;
     if (uploadingDocs[field] !== undefined) return;

     const { file, error } = ensureUploadableImageFile(pickedFile, { maxBytes: 25 * 1024 * 1024 });
     if (error) {
        toast.error(error);
        return;
     }

     setFailedUploads((prev) => ({ ...prev, [field]: undefined }));
     setUploadingDocs((prev) => ({ ...prev, [field]: 0 }));
     try {
        const prepared = await prepareUploadFile(file, field === "profilePhoto" ? { preset: "profile" } : {});
        const formData = new FormData();
        formData.append(field, prepared);
        const res = await deliveryAPI.updateProfileMultipart(formData, {
           onUploadProgress: (event) => {
              if (!event?.total) return;
              const progress = Math.min(99, Math.round((event.loaded / event.total) * 100));
              setUploadingDocs((prev) => (prev[field] === undefined ? prev : { ...prev, [field]: progress }));
           },
        });
        if (!res?.data?.success || !res?.data?.data?.partner?.[field]) {
           throw new Error(res?.data?.message || "The document was not saved. Please try again.");
        }
        const updated = await deliveryAPI.refreshMe();
        const nextProfile = updated?.data?.data?.user ?? updated?.data?.data;
        if (nextProfile) setProfile(nextProfile);
        toast.success("Document updated successfully");
     } catch (e) {
        const message = getUserFacingApiError(e, "Upload failed. Please try again.");
        setFailedUploads((prev) => ({ ...prev, [field]: { message, file } }));
        toast.error(message);
     } finally {
        setUploadingDocs((prev) => {
           const next = { ...prev };
           delete next[field];
           return next;
        });
     }
  };

  const handleTakeCameraPhoto = (field) => {
    openCamera({
      onSelectFile: (file) => handleUpdate(field, file),
      fileNamePrefix: `profile-doc-${field}`
    })
  }

  const handlePickFromGallery = (field) => {
    setUploadField(field)
    openGallery({
      onSelectFile: (file) => handleUpdate(field, file),
      fileNamePrefix: `profile-doc-${field}`,
      fallbackInputRef: fileInputRef,
    })
  }

  const getDocStatus = (doc) => {
    if (!doc?.document) return "Not Uploaded";
    return doc.verified ? "Verified" : "Pending Verification";
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;

  const docs = [
    { label: "Aadhar Card", field: "aadharPhoto", data: profile?.documents?.aadhar },
    { label: "PAN Card", field: "panPhoto", data: profile?.documents?.pan },
    { label: "Driving License", field: "drivingLicensePhoto", data: profile?.documents?.drivingLicense }
  ];

  return (
    <div className="min-h-screen bg-gray-50 font-poppins pb-20">
       <div className="bg-white px-4 py-5 flex items-center gap-4 fixed top-0 w-full z-50 shadow-sm">
          <button onClick={goBack}><ArrowLeft className="w-6 h-6 shadow-sm p-1 rounded-full bg-gray-50 bg-opacity-70" /></button>
          <h1 className="text-xl font-black">Registration Docs</h1>
       </div>

       <div className="pt-24 px-4 space-y-8">
          {/* 1. Vehicle Card */}
          <div className="bg-[#ff8100] rounded-2xl p-6 text-white shadow-xl shadow-orange-500/20 flex flex-col gap-2 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full translate-x-20 -translate-y-20" />
             <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-80 z-10">Vehicle Registered</p>
             <h3 className="text-2xl font-black z-10">{profile?.vehicle?.number || "NO # REGISTERED"}</h3>
             <p className="text-[10px] font-bold z-10 opacity-70 uppercase tracking-widest">{profile?.vehicle?.type || "Standard Bike"}</p>
          </div>

          {/* 2. Documents List */}
          <div className="space-y-4">
             {docs.map((doc, idx) => (
                <div key={idx} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col gap-4 relative">
                   <div className="flex justify-between items-start">
                      <div>
                         <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{doc.label}</p>
                         <h4 className="text-sm font-bold text-gray-800">{getDocStatus(doc.data)}</h4>
                      </div>
                      <div className="flex gap-2">
                         {doc.data?.document && (
                            <button onClick={() => setShowViewer({ title: doc.label, url: doc.data.document })} className="p-3 bg-gray-50 rounded-xl text-gray-600 hover:bg-gray-100 active:scale-95 transition-all"><Eye className="w-5 h-5" /></button>
                         )}
                         <button 
                            onClick={() => handleTakeCameraPhoto(doc.field)}
                            disabled={uploadingDocs[doc.field] !== undefined}
                            className="p-3 bg-gray-900 rounded-xl text-white hover:bg-black active:scale-95 transition-all cursor-pointer relative disabled:opacity-50"
                         >
                            <Camera className="w-5 h-5" />
                         </button>
                         <button 
                            onClick={() => handlePickFromGallery(doc.field)}
                            disabled={uploadingDocs[doc.field] !== undefined}
                            className="p-3 bg-orange-50 rounded-xl text-orange-600 hover:bg-orange-100 active:scale-95 transition-all cursor-pointer relative disabled:opacity-50"
                         >
                            <ImageIcon className="w-5 h-5" />
                         </button>
                      </div>
                   </div>
                   {uploadingDocs[doc.field] !== undefined && (
                      <div className="flex items-center gap-3">
                         <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                         <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-orange-500 transition-all" style={{ width: `${Math.max(5, uploadingDocs[doc.field])}%` }} />
                         </div>
                         <span className="text-[10px] font-bold text-gray-500">{uploadingDocs[doc.field] > 0 ? `${uploadingDocs[doc.field]}%` : "Uploading"}</span>
                      </div>
                   )}
                   {failedUploads[doc.field] && uploadingDocs[doc.field] === undefined && (
                      <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 border border-red-100 px-3 py-2">
                         <p className="text-xs font-semibold text-red-600">{failedUploads[doc.field].message}</p>
                         <button
                            onClick={() => handleUpdate(doc.field, failedUploads[doc.field].file)}
                            className="shrink-0 flex items-center gap-1 rounded-lg bg-white border border-red-200 px-2.5 py-1.5 text-[11px] font-bold text-red-600 active:scale-95"
                         >
                            <RefreshCw className="w-3.5 h-3.5" /> Retry
                         </button>
                      </div>
                   )}
                   {doc.data?.document && (
                      <div className="mt-2 w-24 h-16 rounded-xl border border-gray-100 overflow-hidden shadow-inner bg-gray-50 flex items-center justify-center">
                         <img src={doc.data.document} className="w-full h-full object-cover opacity-50 grayscale" alt="Preview" />
                      </div>
                   )}
                </div>
             ))}
          </div>

          <div className="p-10 text-center opacity-30 mt-10">
             <FileText className="w-16 h-16 mx-auto mb-4" />
             <p className="text-[10px] font-black uppercase tracking-[0.4em]">Official Fleet Identity</p>
          </div>
       </div>

       {/* Simple Modal Image Viewer */}
       <AnimatePresence>
          {showViewer && (
             <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeViewer} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
                <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="relative w-full max-w-lg bg-white rounded-3xl overflow-hidden shadow-2xl">
                   <div className="flex items-center justify-between p-6 border-b border-gray-100">
                      <div className="flex items-center gap-3">
                         <button onClick={closeViewer} className="p-2 rounded-xl text-gray-700 hover:bg-gray-100 active:scale-95 transition-all" aria-label="Back">
                            <ArrowLeft className="w-5 h-5" />
                         </button>
                         <h3 className="text-lg font-black text-gray-950 uppercase tracking-widest">{showViewer.title}</h3>
                      </div>
                      <button onClick={closeViewer} className="p-3 bg-gray-50 rounded-full text-gray-400" aria-label="Close"><X className="w-6 h-6" /></button>
                   </div>
                   <div className="p-2">
                      <img src={showViewer.url} className="w-full h-full object-contain rounded-2xl max-h-[70vh]" alt="Identity Doc" />
                   </div>
                </motion.div>
             </div>
          )}
       </AnimatePresence>
       
       <input 
          ref={fileInputRef}
          type="file" 
          className="hidden" 
          accept="image/*"
          onChange={(e) => {
             if (uploadField && e.target.files[0]) {
                handleUpdate(uploadField, e.target.files[0]);
             }
             e.target.value = "";
          }} 
       />
    </div>
  );
};

export default ProfileDocsV2;

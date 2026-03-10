// Update recipientEmail, Firebase config, store provider, and product checkout links before handing the site off to the customer.
window.CURB_SITE_CONFIG = {
  "businessName": "Hidden Beauty Hair Salon",
  "site": {
    "slug": "hidden-beauty-hair-salon-simcoe",
    "businessName": "Hidden Beauty Hair Salon"
  },
  "contact": {
    "recipientEmail": "bsaunders@rassaun.com",
    "recipientSource": "fallback",
    "deliveryMode": "mailto",
    "subjectPrefix": "New website lead for Hidden Beauty Hair Salon",
    "fallbackMessage": "If your email app did not open, copy the prepared message below and send it manually."
  },
  "cms": {
    "enabled": true,
    "provider": "firebase-auth-firestore",
    "ownerEmail": "",
    "firebase": {
      "apiKey": "",
      "authDomain": "",
      "projectId": "",
      "appId": "",
      "storageBucket": "",
      "messagingSenderId": ""
    },
    "previewMode": {
      "enabled": false,
      "token": "",
      "queryParam": "curb-preview-admin",
      "storageNamespace": "curb-preview-admin"
    }
  },
  "commerce": {
    "enabled": true,
    "provider": "stripe-payment-links",
    "shopPath": "./shop/"
  }
};

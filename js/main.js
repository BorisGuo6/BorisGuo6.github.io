// Main JavaScript file for BorisGuo6.github.io
// Contains all interactive functionality for the personal website

// ============================================================================
// Academic Links Modal Functions
// ============================================================================
function openAcademicLinks() {
  document.getElementById("AcademicLinksModal").style.display = "block";
}

function closeAcademicLinks() {
  document.getElementById("AcademicLinksModal").style.display = "none";
}

// ============================================================================
// WeChat Modal Functions  
// ============================================================================
function openWeChatModal() {
  document.getElementById("WeChatModal").style.display = "block";
}

function closeWeChatModal() {
  document.getElementById("WeChatModal").style.display = "none";
}

// ============================================================================
// Awards Modal Functions
// ============================================================================
var currentAwardType = 'personal';
var awardImages = {};

function openAward(imagePath, imageAlt, personalPath, teamPath) {
  var modal = document.getElementById("AwardModal");
  var img = document.getElementById("awardImage");
  var toggleButtons = document.getElementById("awardToggleButtons");
  var credentialLink = document.getElementById("credentialLink");
  
  if (personalPath && teamPath) {
    // ICRA 2025 Best Paper Award with both personal and team certificates
    awardImages.personal = personalPath;
    awardImages.team = teamPath;
    toggleButtons.style.display = "block";
    credentialLink.style.display = "block";
    switchAward('personal'); // Default to personal
  } else {
    // Regular award with single image
    awardImages = {};
    toggleButtons.style.display = "none";
    credentialLink.style.display = "none";
    img.src = imagePath;
    img.alt = imageAlt;
  }
  
  modal.style.display = "block";
}

function switchAward(type) {
  currentAwardType = type;
  var img = document.getElementById("awardImage");
  var personalBtn = document.getElementById("personalAwardBtn");
  var teamBtn = document.getElementById("teamAwardBtn");
  var credentialLink = document.getElementById("credentialLink");
  
  if (type === 'personal') {
    img.src = awardImages.personal;
    img.alt = "ICRA 2025 Best Paper Award - Personal Certificate";
    personalBtn.style.backgroundColor = "#77BBDD";
    personalBtn.style.color = "white";
    teamBtn.style.backgroundColor = "#cccccc";
    teamBtn.style.color = "#666666";
    credentialLink.style.display = "block";
  } else {
    img.src = awardImages.team;
    img.alt = "ICRA 2025 Best Paper Award - Team Certificate";
    teamBtn.style.backgroundColor = "#77BBDD";
    teamBtn.style.color = "white";
    personalBtn.style.backgroundColor = "#cccccc";
    personalBtn.style.color = "#666666";
    credentialLink.style.display = "none";
  }
}

function closeAward() {
  document.getElementById("AwardModal").style.display = "none";
}

// ============================================================================
// Publications Toggle Functions
// ============================================================================
function togglePapers() {
  const hiddenPapers = document.querySelectorAll('.hidden-paper');
  const highlightPapers = document.querySelectorAll('.highlight-paper');
  const highlightPapersLight = document.querySelectorAll('.highlight-paper-light');
  const toggleButton = document.getElementById('togglePapers');
  const toggleText = document.getElementById('togglePapersText');
  const toggleIcon = document.getElementById('togglePapersIcon');
  const titleElement = document.querySelector('#publications-title');
  const highlightNote = document.querySelector('#highlight-note');
  const isHidden = hiddenPapers[0].style.display === 'none';
  
  hiddenPapers.forEach(paper => {
    paper.style.display = isHidden ? 'table-row' : 'none';
  });
  
  // Control highlight background color
  highlightPapers.forEach(paper => {
    paper.style.backgroundColor = isHidden ? 'rgba(102, 192, 255, 0.2)' : '';
  });
  
  highlightPapersLight.forEach(paper => {
    paper.style.backgroundColor = isHidden ? 'rgba(102, 192, 255, 0.15)' : '';
  });
  
  // Control highlight note
  highlightNote.style.display = isHidden ? 'inline' : 'none';
  
  toggleText.textContent = isHidden ? 'Show Selected Publications' : 'Show All Publications';
  toggleIcon.textContent = isHidden ? '▲' : '▼';
  titleElement.textContent = isHidden ? 'Publications' : 'Selected Publications';
}

// ============================================================================
// Awards Toggle Functions
// ============================================================================
function toggleAwards() {
  const hiddenAwards = document.querySelectorAll('.hidden-award');
  const toggleButton = document.getElementById('toggleAwards');
  const toggleText = document.getElementById('toggleText');
  const toggleIcon = document.getElementById('toggleIcon');
  const isHidden = hiddenAwards[0].style.display === 'none';
  
  hiddenAwards.forEach(award => {
    award.style.display = isHidden ? 'block' : 'none';
  });
  
  toggleText.textContent = isHidden ? 'Show Less Awards' : 'Show More Awards';
  toggleIcon.textContent = isHidden ? '▲' : '▼';
}

// ============================================================================
// Global Event Listeners
// ============================================================================
window.onload = function() {
  // Hide modals on page load
  var wechatModal = document.getElementById("WeChatModal");
  var awardModal = document.getElementById("AwardModal");
  if (wechatModal) {
    wechatModal.style.display = "none";
  }
  if (awardModal) {
    awardModal.style.display = "none";
  }
  
  // Update last update date
  var lastUpdateElement = document.getElementById("lastUpdateDate");
  if (lastUpdateElement) {
    var lastModified = new Date(document.lastModified);
    var options = { year: 'numeric', month: 'long', day: 'numeric' };
    lastUpdateElement.textContent = lastModified.toLocaleDateString('en-US', options);
  }
};

window.onclick = function(event) {
  // Close Academic Links modal when clicking outside
  var academicModal = document.getElementById("AcademicLinksModal");
  if (event.target == academicModal) {
    academicModal.style.display = "none";
  }
  
  // Close WeChat modal when clicking outside
  var wechatModal = document.getElementById("WeChatModal");
  if (event.target == wechatModal) {
    wechatModal.style.display = "none";
  }
  
  // Close Award modal when clicking outside
  var awardModal = document.getElementById("AwardModal");
  if (event.target == awardModal) {
    awardModal.style.display = "none";
  }
};

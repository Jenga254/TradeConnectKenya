const API_URL = "https://tradeconnectkenya.onrender.com";

$(document).ready(function () {
  // ========== CONSTANTS ==========
  const CARDS_PER_PAGE = 3;
  const STATS_UPDATE_INTERVAL = 30000;

  // ========== STATE MANAGEMENT ==========
  const state = {
    currentPage: 1,
    allTradespeople: [],
    allJobs: [],
    currentUser: JSON.parse(localStorage.getItem("user")) || null,
    isAuthenticated: false,
  };

  // ========== DOM CACHE ==========
  const $elements = {
    pageInfo: $("#page-info"),
    prevBtn: $("#prev-btn"),
    nextBtn: $("#next-btn"),
    loadingSpinner: $("#loading-spinner"),
    resultsContainer: $("#results"),
    jobListingsContainer: $("#job-listings"),
    searchBtn: $("#search-btn"),
    authContainer: $(".auth-container"),
    userGreeting: $("#user-greeting"),
    username: $("#username"),
    loginForm: $("#login-form"),
    registerForm: $("#register-form"),
    loginBox: $("#login-box"),
    registerBox: $("#register-box"),
    joinedTodayCount: $("#joined-today-count"),
    joinedUsersList: $("#joined-users-list"),
    tradespeopleCount: $("#tradespeople-count"),
    locationInput: $("#search-location"),
    specializationInput: $("#specialization"),
    homepageContent: $("#homepage-content"),
    authenticatedContent: $("#authenticated-content"),
    tradespersonContent: $("#tradesperson-content"),
    clientContent: $("#client-content"),
    statsSection: $("#stats-section"),
    searchSection: $("#search-section"),
    jobBoardSection: $("#job-board-section"),
    jobPostForm: $("#job-post-form"),
  };

  // ========== INITIALIZATION ==========
  function init() {
    setupEventListeners();
    initializePasswordValidation();
    updateAuthUI();
    fetchSpecializations();

    // Load initial content based on auth state
    if (state.currentUser) {
      if (state.currentUser.type === "tradesperson") {
        fetchJobsForTradesperson();
      } else {
        fetchInitialData();
      }
      fetchStats();
      setInterval(fetchStats, STATS_UPDATE_INTERVAL);
    } else {
      fetchRandomTradespeople();
      fetchTradespeopleCount();
    }
  }

  function fetchSpecializations() {
    apiCall("GET", `${API_URL}/api/tradespeople/specializations`)
      .then((specializations) => {
        const $specializationSelect = $elements.specializationInput;
        $specializationSelect
          .empty()
          .append('<option value="">All Trades</option>');

        specializations.forEach((spec) => {
          $specializationSelect.append(
            `<option value="${spec}">${spec}</option>`
          );
        });
      })
      .catch(showError);
  }

  function initializePasswordValidation() {
    $(document).on("input", 'input[name="password"]', function () {
      const error = validatePassword($(this).val());
      $(this).toggleClass("is-invalid", error !== null);
      $("#password-error")
        .toggle(error !== null)
        .text(error || "");
    });

    $(document).on("input", 'input[name="confirm_password"]', function () {
      const password = $('input[name="password"]').val();
      const doesMatch = $(this).val() === password;
      $(this).toggleClass("is-invalid", !doesMatch);
      $("#confirm-password-error")
        .toggle(!doesMatch)
        .text(doesMatch ? "" : "Passwords do not match");
    });
  }

  function validatePassword(password) {
    const minLength = 8;
    if (password && password.length < minLength) {
      return `Password must be at least ${minLength} characters`;
    }
    return null;
  }

  function fetchInitialJobs() {
    toggleLoading(true);

    // For tradespeople, show jobs matching their specialization by default
    const filters =
      state.currentUser.type === "tradesperson"
        ? { specialization: state.currentUser.specialization }
        : {};

    apiCall("GET", `${API_URL}/api/jobs`, filters)
      .then((jobs) => {
        state.allJobs = jobs;
        renderJobListings(jobs);
      })
      .catch(showError)
      .finally(() => toggleLoading(false));
  }

  // ========== EVENT HANDLERS ==========
  function setupEventListeners() {
    $(document).on("click", ".page-btn", function () {
      currentPage = Number($(this).data("page"));
      renderTradespeople();
    });

    $("#search").on("input", function () {
      handleSearch($(this).val());
    });
  }

  // ========== AUTHENTICATION FUNCTIONS ==========
  function handleLogin(e) {
    e.preventDefault();
    const formData = getFormData($elements.loginForm);

    toggleLoading(true);

    apiCall("POST", `${API_URL}/api/login`, formData)
      .then((response) => {
        saveAuthData(response);
        updateAuthUI();
        showToast(`Welcome back, ${response.user.name}!`, "success");
      })
      .catch(showError)
      .finally(() => toggleLoading(false));
  }

  function handleRegister(e) {
    e.preventDefault();
    const formData = getFormData($elements.registerForm);

    if (formData.password !== formData.confirm_password) {
      return showError({ error: "Passwords don't match" });
    }

    const endpoint =
      formData.userType === "client"
        ? `${API_URL}/api/clients/register`
        : `${API_URL}/api/tradespeople/register`;

    toggleLoading(true);

    apiCall("POST", endpoint, formData)
      .then((response) => {
        if (formData.userType === "tradesperson") {
          saveAuthData(response);
          updateAuthUI();
          showToast(
            "Registration successful! You're now logged in.",
            "success"
          );
        } else {
          showToast("Registration successful! Please login.", "success");
          toggleAuthForms(true);
        }
      })
      .catch(showError)
      .finally(() => toggleLoading(false));
  }

  function logout() {
    localStorage.removeItem("authToken");
    localStorage.removeItem("user");
    state.currentUser = null;
    updateAuthUI();
    showToast("Logged out successfully");
    $("#client-content").hide();
  }

  function updateAuthUI() {
    const isAuthenticated = !!state.currentUser;

    $elements.authContainer.toggle(!isAuthenticated);
    $elements.userGreeting.toggle(isAuthenticated);
    $elements.homepageContent.toggle(!isAuthenticated);
    $elements.authenticatedContent.toggle(isAuthenticated);
    $("#about-section").toggle(!isAuthenticated);

    if (isAuthenticated) {
      $elements.username.text(state.currentUser.name);

      if (state.currentUser.type === "tradesperson") {
        $elements.tradespersonContent.show();
        $elements.clientContent.hide();
        fetchJobsForTradesperson();
      } else {
        $elements.clientContent.show();
        $elements.tradespersonContent.hide();
        fetchInitialData();
        loadApplicationsForClient();
      }
    } else {
      $elements.tradespersonContent.hide();
      $elements.clientContent.hide(); // ✅ Hide this if logged out
      fetchRandomTradespeople();
      fetchTradespeopleCount();
    }
  }

  function toggleAuthForms(showLogin) {
    $elements.loginBox.toggle(showLogin);
    $elements.registerBox.toggle(!showLogin);
  }

  // ========== DATA FETCHING ==========
  function fetchInitialData() {
    toggleLoading(true);
    $elements.resultsContainer.empty();

    apiCall("GET", `${API_URL}/api/tradespeople`)
      .then((data) => {
        state.allTradespeople = data;
        state.currentPage = 1;
        updateResultsDisplay();
        updatePaginationControls();
      })
      .catch(showError)
      .finally(() => toggleLoading(false));
  }

  function fetchJobsForTradesperson() {
    console.log("Fetching jobs for:", state.currentUser);
    toggleLoading(true);

    apiCall("GET", `${API_URL}/api/jobs`, {
      specialization: state.currentUser.specialization,
      location: state.currentUser.location,
    })
      .then((jobs) => {
        console.log("Received jobs:", jobs);
        if (jobs.length === 0) {
          console.warn("No jobs returned despite existing in database");
        }
        state.allJobs = jobs;
        renderJobListings(jobs);
      })
      .catch((error) => {
        console.error("Error fetching jobs:", error);
        showError(error);
      })
      .finally(() => toggleLoading(false));
  }
  function fetchRandomTradespeople() {
    toggleLoading(true);

    apiCall("GET", `${API_URL}/api/tradespeople/random`)
      .then((data) => {
        state.allTradespeople = data;
        updateResultsDisplay();
        showRegistrationPrompt();
      })
      .catch(showError)
      .finally(() => toggleLoading(false));
  }

  function fetchStats() {
    $.ajax({
      url: `${API_BASE}/tradespeople/stats`,
      method: "GET",
      xhrFields: {
        withCredentials: true,
      },
      success: function (data) {
        animateCount("#tradespeople-count", data.total);
        updateTodayBox(data.today, data.todayUsers);
      },
      error: function (err) {
        console.error("Failed to fetch stats:", err);
      },
    });
  }
  function renderTradespeople() {
    const start = (currentPage - 1) * 6;
    const paginated = allTradespeople.slice(start, start + 6);
    $("#tradespeople-list").empty();

    paginated.forEach((tp) => {
      $("#tradespeople-list").append(`
        <div class="tradesperson-card">
          <h3>${tp.name}</h3>
          <p><strong>Specialization:</strong> ${tp.specialization}</p>
          <p><strong>Location:</strong> ${tp.location}</p>
          <p><strong>Experience:</strong> ${tp.experience_years} years</p>
          <p><strong>Rating:</strong> ${tp.avg_rating}</p>
        </div>
      `);
    });
  }
  function renderPagination() {
    const totalPages = Math.ceil(allTradespeople.length / 6);
    $("#pagination").empty();
    for (let i = 1; i <= totalPages; i++) {
      $("#pagination").append(
        `<button class="page-btn" data-page="${i}">${i}</button>`
      );
    }
  }

  function fetchTradespeople() {
    $.ajax({
      url: `${API_BASE}/tradespeople`,
      method: "GET",
      xhrFields: {
        withCredentials: true,
      },
      success: function (data) {
        allTradespeople = data;
        renderTradespeople();
        renderPagination();
      },
      error: function (err) {
        console.error("Failed to fetch tradespeople:", err);
      },
    });
  }
  // ========== SEARCH FUNCTIONALITY ==========
  function handleSearch(query) {
    const filtered = allTradespeople.filter((tp) =>
      tp.name.toLowerCase().includes(query.toLowerCase())
    );
    $("#tradespeople-list").empty();
    filtered.forEach((tp) => {
      $("#tradespeople-list").append(`
        <div class="tradesperson-card">
          <h3>${tp.name}</h3>
          <p><strong>Specialization:</strong> ${tp.specialization}</p>
          <p><strong>Location:</strong> ${tp.location}</p>
          <p><strong>Experience:</strong> ${tp.experience_years} years</p>
          <p><strong>Rating:</strong> ${tp.avg_rating}</p>
        </div>
      `);
    });
  }
  // ========== JOB BOARD FUNCTIONS ==========
  // ========== JOB BOARD FUNCTIONS ==========
  function handleJobPosting(e) {
    e.preventDefault();

    // Get form data
    const formData = {
      title: $elements.jobPostForm.find('[name="title"]').val().trim(),
      description: $elements.jobPostForm
        .find('[name="description"]')
        .val()
        .trim(),
      location: $elements.jobPostForm.find('[name="location"]').val().trim(),
      category: $elements.jobPostForm.find('[name="category"]').val().trim(),
      budget: $elements.jobPostForm.find('[name="budget"]').val()
        ? parseInt($elements.jobPostForm.find('[name="budget"]').val())
        : null,
    };

    // Clear previous errors
    $(".is-invalid").removeClass("is-invalid");
    $(".invalid-feedback").hide();

    // Validate required fields
    const requiredFields = ["title", "description", "location", "category"];
    let isValid = true;

    requiredFields.forEach((field) => {
      if (!formData[field]) {
        $(`[name="${field}"]`).addClass("is-invalid");
        $(`#${field}-error`).text("This field is required").show();
        isValid = false;
      }
    });

    if (!isValid) {
      showToast("Please fill all required fields", "error");
      return;
    }

    toggleLoading(true);

    apiCall("POST", `${API_URL}/api/jobs`, formData)
      .then((response) => {
        showToast("Job posted successfully!", "success");
        addJobListing(response);
        $elements.jobPostForm[0].reset();
      })
      .catch((err) => {
        console.error("Job posting error:", err);

        // Handle specific field errors from server
        if (err.error === "Missing required fields") {
          err.missing?.forEach((field) => {
            $(`[name="${field}"]`).addClass("is-invalid");
            $(`#${field}-error`).text("This field is required").show();
          });
        }

        showToast(err.error || "Failed to post job", "error");
      })
      .finally(() => toggleLoading(false));
  }

  function handleJobSearch() {
    const filters = {
      specialization: $("#job-specialization-filter").val(),
      location: $("#job-location-filter").val(),
    };

    toggleLoading(true);
    console.log("Fetching jobs with filters:", filters);

    apiCall("GET", `${API_URL}/api/jobs`, filters)
      .then((jobs) => {
        state.allJobs = jobs;
        renderJobListings(jobs);

        if (jobs.length === 0) {
          showToast("No jobs found matching your criteria", "info");
        }
      })
      .catch((error) => {
        console.error("Error fetching jobs:", error);
        showError(error);
      })
      .finally(() => toggleLoading(false));
  }

  function handleJobApplication() {
    const jobId = $(this).data("job-id");
    const jobTitle = $(this).closest(".job-card").find("h3").text();

    toggleLoading(true);

    apiCall("POST", `${API_URL}/api/jobs/apply`, {
      job_id: jobId,
      tradesperson_id: state.currentUser.id,
    })
      .then(() => {
        showToast(`Application submitted for: ${jobTitle}`, "success");
        $(this).prop("disabled", true).text("Applied");
      })
      .catch(showError)
      .finally(() => toggleLoading(false));
  }

  // ========== UI UPDATES ==========
  function updateResultsDisplay() {
    const startIdx = (state.currentPage - 1) * CARDS_PER_PAGE;
    const paginatedData = state.allTradespeople.slice(
      startIdx,
      startIdx + CARDS_PER_PAGE
    );

    $elements.resultsContainer.html(
      paginatedData.map(createTradeCard).join("")
    );
  }
  function renderJobListings(jobs) {
    const $container = $("#job-listings");
    $container.empty();

    if (jobs.length === 0) {
      $container.html(
        '<p class="no-jobs">No jobs found matching your criteria</p>'
      );
      return;
    }

    jobs.forEach((job) => {
      const appliedInfo = job.applied
        ? `<span class="applied-label">Applied on ${new Date(
            job.applied_at
          ).toLocaleDateString()}</span>`
        : `<button class="apply-btn" data-job-id="${job.id}">Apply for Job</button>`;

      $container.append(`
    <div class="job-card">
      <h3>${job.title}</h3>
      <p><strong>Client:</strong> ${job.client_name || "Unknown"}</p>
      <p><strong>Category:</strong> ${job.category}</p>
      <p><strong>Location:</strong> ${job.location}</p>
      ${job.budget ? `<p><strong>Budget:</strong> KSh${job.budget}</p>` : ""}
      <p>${job.description}</p>
      ${state.currentUser?.type === "tradesperson" ? appliedInfo : ""}
    </div>
  `);
    });
  }
  function createTradeCard(tradesperson) {
    return `
      <div class="trade-card">
        <div class="trade-card-header">
          <div class="trade-card-header-text">
            <h3>${tradesperson.name}</h3>
            <p class="trade-title">${tradesperson.specialization}</p>
          </div>
          <span class="badge">PRO</span>
        </div>
        <div class="trade-card-body">
          <p><i class="fas fa-map-marker-alt"></i> ${tradesperson.location}</p>
          <p><i class="fas fa-phone"></i> ${tradesperson.phone}</p>
          <p><i class="fas fa-envelope"></i> ${tradesperson.email}</p>
          <p><i class="fas fa-briefcase"></i> ${tradesperson.experience_years} years experience</p>
          <p class="trade-bio">"${tradesperson.bio}"</p>
        </div>
      </div>
    `;
  }

  function showRegistrationPrompt() {
    $elements.resultsContainer.append(`
      <div class="registration-prompt">
        <div class="prompt-content">
          <h3>Want to see more tradespeople?</h3>
          <p>Register now to access our full network of professionals</p>
          <button id="show-register-prompt" class="btn-primary">
            Sign Up Now
          </button>
        </div>
      </div>
    `);

    $("#show-register-prompt").on("click", () => toggleAuthForms(false));
  }

  function addJobListing(job) {
    $elements.jobListingsContainer.prepend(`
      <div class="job-card">
        <h3>${job.title}</h3>
        <p><strong>Category:</strong> ${job.category}</p>
        <p><strong>Location:</strong> ${job.location}</p>
        ${job.budget ? `<p><strong>Budget:</strong> KSh${job.budget}</p>` : ""}
        <p>${job.description}</p>
        <button class="apply-btn">Apply for Job</button>
      </div>
    `);
  }

  function updateTodayBox(jobs, users) {
    $("#today-jobs").text(jobs);
    $("#today-users").text(users);
  }

  function updatePaginationControls() {
    const maxPage = Math.ceil(state.allTradespeople.length / CARDS_PER_PAGE);
    $elements.pageInfo.text(`Page ${state.currentPage} of ${maxPage}`);
    $elements.prevBtn.prop("disabled", state.currentPage === 1);
    $elements.nextBtn.prop("disabled", state.currentPage === maxPage);
  }

  function goToPreviousPage() {
    if (state.currentPage > 1) {
      state.currentPage--;
      updateResultsDisplay();
      updatePaginationControls();
    }
  }

  function goToNextPage() {
    const maxPage = Math.ceil(state.allTradespeople.length / CARDS_PER_PAGE);
    if (state.currentPage < maxPage) {
      state.currentPage++;
      updateResultsDisplay();
      updatePaginationControls();
    }
  }

  function animateCount(selector, count) {
    let current = 0;
    const increment = Math.ceil(count / 100);
    const interval = setInterval(() => {
      current += increment;
      if (current >= count) {
        current = count;
        clearInterval(interval);
      }
      $(selector).text(current);
    }, 20);
  }

  function toggleLoading(show) {
    $elements.loadingSpinner.toggle(show);
    if (state.currentUser?.type === "tradesperson") {
      $elements.jobListingsContainer.toggle(!show);
    } else {
      $elements.resultsContainer.toggle(!show);
    }
  }

  // ========== UTILITY FUNCTIONS ==========
  function apiCall(method, url, data) {
    return new Promise((resolve, reject) => {
      const config = {
        url,
        type: method,
        contentType: "application/json",
      };

      if (method === "GET" && data) {
        const queryParams = new URLSearchParams(data).toString();
        config.url += `?${queryParams}`;
      } else if (data) {
        config.data = JSON.stringify(data);
      }

      if (state.currentUser) {
        config.headers = {
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        };
      }

      $.ajax(config)
        .done(resolve)
        .fail((xhr) => {
          if (xhr.status === 401) handleUnauthorized();
          reject(xhr.responseJSON || { error: xhr.statusText });
        });
    });
  }

  function getFormData($form) {
    return $form.serializeArray().reduce((obj, item) => {
      obj[item.name] = item.value;
      return obj;
    }, {});
  }

  function saveAuthData(response) {
    localStorage.setItem("authToken", response.token);
    localStorage.setItem("user", JSON.stringify(response.user));
    state.currentUser = response.user;
  }

  function showError(error) {
    console.error("Error:", error);
    $(".is-invalid").removeClass("is-invalid");
    $(".invalid-feedback").text("");

    if (error.errors) {
      Object.entries(error.errors).forEach(([field, message]) => {
        $(`[name="${field}"]`).addClass("is-invalid");
        $(`#${field}-error`).text(message);
      });
    } else {
      showToast(error.error || "An error occurred");
    }
  }

  function handleUnauthorized() {
    showToast("Session expired. Please login again.");
    logout();
  }

  function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "toast show";

    if (type === "error") toast.style.background = "#e63946";
    if (type === "success") toast.style.background = "#2a9d8f";

    setTimeout(() => {
      toast.className = "toast";
    }, 3000);
  }

  function loadApplicationsForClient() {
    if (!state.currentUser || state.currentUser.type !== "client") return;

    apiCall("GET", `${API_URL}/api/client/applications`)
      .then((applications) => {
        const $tableBody = $("#applications-table tbody");
        $tableBody.empty();

        if (applications.length === 0) {
          $("#no-applications").show();
          return;
        }

        $("#no-applications").hide();

        applications.forEach((app) => {
          const row = `
    <tr>
      <td data-label="Job">${app.job_title}</td>
      <td data-label="Name">${app.tradesperson_name}</td>
      <td data-label="Specialization">${app.specialization}</td>
      <td data-label="Location">${app.location}</td>
      <td data-label="Experience">${app.experience_years} yrs</td>
      <td data-label="Bio">${app.bio}</td>
      <td data-label="Phone">${app.phone}</td>
      <td data-label="Email"><a href="mailto:${app.email}">${app.email}</a></td>
      <td data-label="Applied At">${new Date(
        app.applied_at
      ).toLocaleString()}</td>
    </tr>
  `;
          $tableBody.append(row);
        });
      })
      .catch(showError);
  }
  window.onpageshow = function (event) {
    if (event.persisted) {
      location.reload(); // Forces fresh reload when navigating back
    }
  };
  setTimeout(() => {
    $(".today-joined-highlight").fadeOut("slow");
  }, 5000); // 5000ms = 5 seconds
  fetchStats();
  fetchTradespeople();
  setupEventListeners();
  // ========== START APPLICATION ==========
  init();
});

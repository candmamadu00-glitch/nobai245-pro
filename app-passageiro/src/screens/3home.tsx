 <Text style={styles.sectionLabel}>{t('reference_point', 'Ponto de Referência (Opcional)')}</Text>
                <View style={styles.referenceContainer}>
                  <TextInput
                    style={styles.referenceInput}
                    placeholder={t('reference_placeholder', 'Ex: Próximo à farmácia, casa azul...')}
                    placeholderTextColor="#94A3B8"
                    value={referencePoint}
                    onChangeText={setReferencePoint}
                  />
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.cancelButtonOutline} onPress={() => setBookingStep('ADDRESS')}>
                    <Text style={styles.cancelButtonOutlineText}>{t('back_btn', 'Voltar')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.requestButton, { flex: 1, marginLeft: 10 }]} onPress={() => setBookingStep('PAYMENT')}>
                    <Text style={styles.requestButtonText}>{t('continue_btn', 'Continuar')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {rideStatus === 'idle' && bookingStep === 'PAYMENT' && (
              <View style={{ width: '100%' }}>
                <Text style={styles.sectionLabel}>{t('payment_method', 'Forma de Pagamento')}</Text>
                <View style={styles.paymentOptionsContainer}>
                  <TouchableOpacity 
                    style={[styles.paymentBtn, paymentMethod === 'ORANGE_MONEY' && styles.paymentBtnActive]}
                    onPress={() => setPaymentMethod('ORANGE_MONEY')}
                  >
                    <Ionicons name="phone-portrait-outline" size={18} color={paymentMethod === 'ORANGE_MONEY' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.paymentBtnText, paymentMethod === 'ORANGE_MONEY' && styles.paymentBtnTextActive]}>Orange Money</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.paymentBtn, paymentMethod === 'MTN_MOMO' && styles.paymentBtnActive]}
                    onPress={() => setPaymentMethod('MTN_MOMO')}
                  >
                    <Ionicons name="phone-portrait-outline" size={18} color={paymentMethod === 'MTN_MOMO' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.paymentBtnText, paymentMethod === 'MTN_MOMO' && styles.paymentBtnTextActive]}>MTN MoMo</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.paymentBtn, paymentMethod === 'CASH' && styles.paymentBtnActive]}
                    onPress={() => setPaymentMethod('CASH')}
                  >
                    <Ionicons name="cash-outline" size={18} color={paymentMethod === 'CASH' ? '#0F172A' : '#64748B'} />
                    <Text style={[styles.paymentBtnText, paymentMethod === 'CASH' && styles.paymentBtnTextActive]}>{t('cash', 'Dinheiro')}</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.cancelButtonOutline} onPress={() => setBookingStep('SERVICE_AND_PRICE')}>
                    <Text style={styles.cancelButtonOutlineText}>{t('back_btn', 'Voltar')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.requestButton, { flex: 1, marginLeft: 10 }]} onPress={handleInitialRequestRide}>
                    <Text style={styles.requestButtonText}>{t('request_now_btn', 'Pedir Agora')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {(rideStatus === 'accepted' || rideStatus === 'arrived') && Boolean(activeOtpPin) && (
              <View style={styles.pinCardContainer}>
                <View style={styles.pinHeader}>
                  <Ionicons name="shield-checkmark-sharp" size={18} color="#10B981" />
                  <Text style={styles.pinTitle}>{t('boarding_pin_title', 'PIN DE EMBARQUE')}</Text>
                </View>
                <Text style={styles.pinSubtitle}>{t('tell_pin_to_driver_msg', 'Fale este código ao motorista para iniciar a corrida')}</Text>
                <View style={styles.pinDigitsRow}>
                  {activeOtpPin.split('').map((digit, index) => (
                    <View key={index} style={styles.pinDigitBox}>
                      <Text style={styles.pinDigitText}>{digit}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {rideStatus === 'searching' && (
              <View style={styles.statusBox}>
                <ActivityIndicator size="large" color="#EAB308" style={{ marginBottom: 12 }} />
                <Text style={styles.statusTitle}>{t('searching_drivers_title', 'Buscando motoristas...')}</Text>
                <Text style={styles.statusSub}>{t('locating_nearest_vehicle', 'Localizando o veículo mais próximo de você.')}</Text>
                <TouchableOpacity style={[styles.cancelButtonOutline, { marginTop: 16 }]} onPress={() => setShowCancelModal(true)}>
                  <Text style={styles.cancelButtonOutlineText}>{t('cancel_search_btn', 'Cancelar Busca')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {driverInfo && rideStatus !== 'searching' && (
              <View style={styles.driverCardContainer}>
                <View style={styles.driverMainInfo}>
                  {driverInfo?.photoUrl ? (
                    <Image source={{ uri: driverInfo.photoUrl }} style={styles.driverAvatarProfile} />
                  ) : (
                    <View style={styles.driverAvatarProfile}>
                      <Ionicons name="person" size={24} color="#94A3B8" />
                    </View>
                  )}
                  
                  <View style={styles.driverDetails}>
                    <Text style={styles.driverName}>{driverInfo?.name || 'Motorista'}</Text>
                    <View style={styles.driverRatingBadge}>
                      <Ionicons name="star" size={14} color="#EAB308" />
                      <Text style={styles.driverRatingText}>{driverInfo?.rating || 5.0}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.dividerLight} />

                <View style={styles.vehicleShowcase}>
                  <Image 
                    source={
                      VEHICLE_OPTIONS.find(v => 
                        v.id.toLowerCase() === (driverInfo?.vehicleType || 'particular').toLowerCase().replace('_', '-')
                      )?.image || require('../assets/vehicles/carro_white.png')
                    } 
                    style={styles.showcaseVehicleImg} 
                    resizeMode="contain" 
                  />
                  
                  <View style={styles.vehicleDetailsCol}>
                    <Text style={styles.vehicleModelText} numberOfLines={1}>
                      {driverInfo?.carModel || t('standard_vehicle', 'Veículo Padrão')}
                    </Text>
                    
                    <View style={styles.colorAndPlateRow}>
                      <View style={[styles.modernColorChip, { backgroundColor: getVehicleColorHex(driverInfo?.carColor) }]} />
                      <Text style={styles.vehicleColorText}>{driverInfo?.carColor || t('color_not_specified', 'Cor não informada')}</Text>
                      
                      <View style={styles.dotSeparator} />
                      
                      <View style={styles.modernPlateBadge}>
                        <Text style={styles.modernPlateText}>{driverInfo?.licensePlate?.toUpperCase() || t('no_license_plate', 'SEM PLACA')}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            )}

            {['accepted', 'arrived', 'in_progress'].includes(rideStatus) && driverInfo && (
              <View style={{ width: '100%' }}>
                <View style={styles.statusBanner}>
                  <Text style={styles.statusBannerText}>
                    {rideStatus === 'accepted' 
                      ? (driverEta ? `${t('arriving_in', 'Chegando em')} ${driverEta} min` : t('driver_on_way', 'Motorista a caminho')) :
                     rideStatus === 'arrived' 
                      ? t('driver_arrived', 'O motorista chegou!') : 
                     (driverEta ? `${t('destination_in', 'Destino em')} ${driverEta} min` : t('ride_in_progress', 'Viagem em andamento'))}
                  </Text>
                  <TouchableOpacity onPress={handleShareTrip} style={styles.shareButton}>
                    <Ionicons name="share-social-outline" size={18} color="#0F172A" />
                  </TouchableOpacity>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity 
                    style={[styles.iconCircleButton, styles.sosButton]} 
                    onPress={handleSosPress}
                  >
                    <Ionicons name="shield-checkmark" size={18} color="#EF4444" />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.iconCircleButton} onPress={handleCallDriver}>
                    <Ionicons name="call" size={18} color="#0F172A" />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.cancelButtonOutline} onPress={() => setShowCancelModal(true)}>
                    <Text style={styles.cancelButtonOutlineText}>{t('cancel_ride', 'Cancelar')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.requestButton, { flex: 1, marginLeft: 6 }]} onPress={() => setIsChatVisible(true)}>
                    <Ionicons name="chatbubble-ellipses" size={16} color="#0F172A" style={{ marginRight: 6 }} />
                    <Text style={styles.requestButtonText}>Chat</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* KEYBOARD AVOIDING VIEW - MODAL DE IDIOMAS */}
      <Modal visible={langModalVisible} transparent animationType="slide" onRequestClose={() => setLangModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>{t('select_language', 'Selecione o Idioma')}</Text>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={styles.langOption}
                onPress={() => changeLanguage(lang.code)}
              >
                <Text style={styles.langOptionText}>{lang.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity 
              style={styles.closeButton} 
              onPress={() => setLangModalVisible(false)}
            >
              <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>{t('back_btn', 'Fechar')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* KEYBOARD AVOIDING VIEW - MODAL DE PERMISSÃO DE GPS */}
      <Modal visible={isLocationSettingsVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.locationModalCard}>
            <View style={styles.locationIconBg}>
              <Ionicons name="location" size={32} color="#EAB308" />
            </View>
            <Text style={styles.locationModalTitle}>{t('location_needed_title', 'Localização Necessária')}</Text>
            <Text style={styles.locationModalText}>
              {locationError || t('location_needed_desc', 'Para encontrar motoristas rapidamente e garantir sua segurança, precisamos que ative o GPS e permita o acesso no seu celular.')}
            </Text>
            
            <TouchableOpacity 
              style={[styles.requestButton, { width: '100%', marginBottom: 12 }]} 
              onPress={() => Linking.openSettings()}
            >
              <Text style={styles.requestButtonText}>{t('open_settings', 'Abrir Configurações')}</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.cancelButtonOutline} 
              onPress={getCurrentLocationWithFallback}
            >
              <Text style={styles.cancelButtonOutlineText}>{t('try_again', 'Já ativei / Tentar novamente')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* KEYBOARD AVOIDING VIEW - MODAL DE CONVIDADO / TERCEIROS */}
      <Modal visible={isGuestModalVisible} transparent animationType="slide" onRequestClose={() => setIsGuestModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.locationModalCard}>
              <Text style={styles.locationModalTitle}>Para quem é a corrida?</Text>
              <TextInput
                style={[styles.referenceInput, { width: '100%', marginBottom: 12 }]}
                placeholder="Nome do passageiro"
                placeholderTextColor="#94A3B8"
                value={guestName}
                onChangeText={setGuestName}
              />
              <TextInput
                style={[styles.referenceInput, { width: '100%', marginBottom: 20 }]}
                placeholder="Telefone (Opcional)"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                value={guestPhone}
                onChangeText={setGuestPhone}
              />
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.cancelButtonOutline} onPress={() => { setIsForAnotherPerson(false); setIsGuestModalVisible(false); }}>
                  <Text style={styles.cancelButtonOutlineText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.requestButton, { flex: 1, marginLeft: 10 }]} onPress={() => { setIsForAnotherPerson(true); setIsGuestModalVisible(false); }}>
                  <Text style={styles.requestButtonText}>Confirmar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* KEYBOARD AVOIDING VIEW - MODAL DE PAGAMENTO MOBILE MONEY */}
      <Modal visible={isPaymentModalVisible} transparent animationType="slide" onRequestClose={() => !isProcessingPayment && setIsPaymentModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.paymentModalCard}>
              <View style={[styles.operatorHeader, { backgroundColor: paymentMethod === 'ORANGE_MONEY' ? '#FF6600' : '#FFCC00' }]}>
                <Ionicons name="phone-portrait-sharp" size={24} color={paymentMethod === 'ORANGE_MONEY' ? '#FFFFFF' : '#000000'} />
                <Text style={[styles.operatorTitle, { color: paymentMethod === 'ORANGE_MONEY' ? '#FFFFFF' : '#000000' }]}>
                  {paymentMethod === 'ORANGE_MONEY' ? 'Orange Money' : 'MTN Mobile Money'}
                </Text>
              </View>

              <ScrollView style={styles.paymentModalBody} contentContainerStyle={{ paddingBottom: 10 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.paymentModalSubtitle}>
                  {t('ussd_push_instruction', 'Confirme seu número. Você receberá um alerta seguro da operadora no seu celular para digitar seu PIN.')}
                </Text>

                <View style={styles.amountBadge}>
                  <Text style={styles.amountTextLabel}>{t('total_amount', 'Valor Total:')}</Text>
                  <Text style={styles.amountValue}>
                    {estimatedPrice ? `${estimatedPrice.toLocaleString('pt-GW')} XOF` : t('calculating', 'Calculando...')}
                  </Text>
                </View>

                <Text style={styles.inputLabel}>{t('mobile_money_account', 'Número da Conta Mobile Money')}</Text>
                <View style={styles.phoneInputContainer}>
                  <Text style={styles.countryCode}>+245</Text>
                  <TextInput
                    style={styles.phoneInput}
                    value={paymentPhone}
                    onChangeText={setPaymentPhone}
                    keyboardType="phone-pad"
                    editable={!isProcessingPayment}
                  />
                </View>
                <View style={styles.modalActionsRow}>
                  <TouchableOpacity style={styles.cancelModalBtn} disabled={isProcessingPayment} onPress={() => setIsPaymentModalVisible(false)}>
                    <Text style={styles.cancelModalBtnText}>{t('back_btn', 'Cancelar')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.confirmModalBtn, { backgroundColor: paymentMethod === 'ORANGE_MONEY' ? '#FF6600' : '#004F9F' }]}
                    disabled={isProcessingPayment}
                    onPress={confirmPaymentAndRide}
                  >
                    {isProcessingPayment ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.confirmModalBtnText}>{t('confirm_payment_btn', 'Confirmar Solicitação')}</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* MENU LATERAL */}
      <Modal visible={isMenuVisible} animationType="fade" transparent onRequestClose={() => setIsMenuVisible(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setIsMenuVisible(false)}>
          <View style={styles.menuDrawer}>
            <View style={styles.menuHeader}>
              <View style={styles.avatarPlaceholderLarge}>
                {user?.profilePicture ? (
                  <Image source={{ uri: formatPhotoUrl(user.profilePicture) }} style={{ width: '100%', height: '100%', borderRadius: 30 }} />
                ) : (
                  <Ionicons name="person" size={32} color="#0F172A" />
                )}
              </View>
              <Text style={styles.menuUserName}>{user?.fullName || t('passenger', 'Passageiro')}</Text>
              <Text style={styles.menuUserPhone}>{user?.phone || ''}</Text>
            </View>

            <View style={styles.menuItems}>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('Profile'); }}>
                <Ionicons name="person-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('my_profile', 'Meu Perfil')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('RideHistory'); }}>
                <Ionicons name="time-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('my_rides', 'Minhas Corridas')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('EmergencyContacts'); }}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('emergency_contacts', 'Contatos de Emergência')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); navigation.navigate('HelpCenter'); }}>
                <Ionicons name="help-buoy-outline" size={20} color="#0F172A" />
                <Text style={styles.menuItemText}>{t('help_center', 'Central de Ajuda')}</Text>
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity style={styles.menuItem} onPress={() => { setIsMenuVisible(false); signOut(); }}>
                <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                <Text style={[styles.menuItemText, { color: '#EF4444' }]}>{t('logout', 'Sair da Conta')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* KEYBOARD AVOIDING VIEW - CHAT INTERNO */}
      <Modal visible={isChatVisible} animationType="slide" transparent onRequestClose={() => setIsChatVisible(false)}>
        <KeyboardAvoidingView 
          style={styles.chatOverlay} 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'android' ? 10 : 0}
        >
          <View style={styles.chatContainer}>
            <View style={styles.chatHeader}>
              <View style={styles.chatHeaderUserInfo}>
                {driverInfo?.profilePicture ? (
                  <Image source={{ uri: formatPhotoUrl(driverInfo.profilePicture) }} style={styles.headerAvatar} />
                ) : (
                  <View style={styles.headerAvatarPlaceholder}>
                    <Ionicons name="person" size={18} color="#64748B" />
                  </View>
                )}
                <Text style={styles.chatTitle}>
                  {t('chat_with', 'Chat com')} {driverInfo?.name || 'Motorista'}
                </Text>
              </View>

              <TouchableOpacity onPress={() => setIsChatVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color="#0F172A" />
              </TouchableOpacity>
            </View>

            <FlatList
              ref={chatFlatListRef}
              data={messages}
              keyExtractor={(item, index) => item.id || `msg-${index}`}
              contentContainerStyle={styles.chatList}
              onContentSizeChange={() => chatFlatListRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => {
                const isPassenger = item.sender === 'passenger';
                const photoUrl = formatPhotoUrl(item.senderPhoto || (isPassenger ? user?.profilePicture : driverInfo?.profilePicture));

                return (
                  <View style={[styles.messageRow, isPassenger ? styles.rowPassenger : styles.rowDriver]}>
                    {!isPassenger && (
                      photoUrl ? (
                        <Image source={{ uri: photoUrl }} style={styles.chatBubbleAvatar} />
                      ) : (
                        <View style={styles.chatBubbleAvatarPlaceholder}>
                          <Ionicons name="person" size={12} color="#64748B" />
                        </View>
                      )
                    )}

                    <View style={[styles.messageBubble, isPassenger ? styles.messagePassenger : styles.messageDriver]}>
                      <Text style={[styles.messageText, isPassenger ? styles.textPassenger : styles.textDriver]}>
                        {item.text}
                      </Text>
                    </View>

                    {isPassenger && (
                      photoUrl ? (
                        <Image source={{ uri: photoUrl }} style={styles.chatBubbleAvatar} />
                      ) : (
                        <View style={styles.chatBubbleAvatarPlaceholder}>
                          <Ionicons name="person" size={12} color="#64748B" />
                        </View>
                      )
                    )}
                  </View>
                );
              }}
            />

            <View style={[styles.chatInputContainer, { paddingBottom: Platform.OS === 'android' ? 16 : 12 }]}>
              <TextInput
                style={styles.chatInput}
                value={inputText}
                onChangeText={setInputText}
                placeholder={t('type_something', 'Escreva algo...')}
                placeholderTextColor="#94A3B8"
              />
              <TouchableOpacity style={styles.chatSendButton} onPress={sendMessage}>
                <Ionicons name="send" size={16} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* KEYBOARD AVOIDING VIEW - MODAL DE BUSCA DE ENDEREÇO MAPBOX */}
      <Modal visible={isSearchModalVisible} animationType="slide" transparent={false} onRequestClose={() => setIsSearchModalVisible(false)}>
        <SafeAreaView style={styles.searchModalContainer}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={styles.searchHeader}>
              <TouchableOpacity onPress={() => setIsSearchModalVisible(false)} style={styles.backButton}>
                <Ionicons name="arrow-back" size={22} color="#0F172A" />
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.passengerSelector} onPress={() => setIsGuestModalVisible(true)}>
                <Ionicons name="person" size={13} color="#475569" style={{ marginRight: 6 }} />
                <Text style={styles.passengerSelectorText}>
                  {isForAnotherPerson ? (guestName || 'Outra Pessoa') : t('for_me', 'Para mim')}
                </Text>
              </TouchableOpacity>
              <View style={{ width: 40 }} />
            </View>

            <View style={styles.modalBody}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15, paddingHorizontal: 10 }}>
                
                <View style={{ alignItems: 'center', marginRight: 15 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#94A3B8' }} />
                  <View style={{ width: 1, height: showExtraStop ? 45 : 35, backgroundColor: '#E2E8F0', marginVertical: 4 }} />
                  {showExtraStop && (
                     <>
                       <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#3B82F6' }} />
                       <View style={{ width: 1, height: 45, backgroundColor: '#E2E8F0', marginVertical: 4 }} />
                     </>
                  )}
                  <View style={{ width: 8, height: 8, backgroundColor: '#0F172A' }} />
                </View>

                <View style={{ flex: 1 }}>
                  <View style={[styles.mapboxSearchInputWrapper, searchType === 'pickup' ? { borderColor: '#EAB308', borderWidth: 1 } : { marginBottom: 10, borderWidth: 0 }]}>
                    <TextInput
                      style={styles.mapboxSearchInput}
                      placeholder={t('pickup_location', 'Local de Partida')}
                      placeholderTextColor="#94A3B8"
                      value={searchType === 'pickup' ? searchQuery : pickupAddress}
                      onFocus={() => { setSearchType('pickup'); setSearchQuery(pickupAddress); }}
                      onChangeText={handleMapboxSearch}
                    />
                    {isSearchingMapbox && searchType === 'pickup' && <ActivityIndicator size="small" color="#EAB308" />}
                  </View>

                  {showExtraStop && (
                     <View style={[styles.mapboxSearchInputWrapper, searchType === 'extraStop' ? { borderColor: '#3B82F6', borderWidth: 1 } : { marginBottom: 10, borderWidth: 0 }]}>
                       <TextInput
                         style={styles.mapboxSearchInput}
                         placeholder="Adicionar parada..."
                         placeholderTextColor="#94A3B8"
                         value={searchType === 'extraStop' ? searchQuery : extraStopAddress}
                         onFocus={() => { setSearchType('extraStop'); setSearchQuery(extraStopAddress); }}
                         onChangeText={handleMapboxSearch}
                       />
                       <TouchableOpacity onPress={() => { setShowExtraStop(false); setExtraStopAddress(''); setExtraStopCoords(null); }}>
                          <Ionicons name="close-circle" size={20} color="#94A3B8" />
                       </TouchableOpacity>
                     </View>
                  )}

                  <View style={[styles.mapboxSearchInputWrapper, searchType === 'dropoff' ? { borderColor: '#EAB308', borderWidth: 1 } : { borderWidth: 0 }]}>
                    <TextInput
                      style={styles.mapboxSearchInput}
                      placeholder={t('where_to', 'Para onde vamos?')}
                      placeholderTextColor="#94A3B8"
                      value={searchType === 'dropoff' ? searchQuery : dropoffAddress}
                      onFocus={() => { setSearchType('dropoff'); setSearchQuery(dropoffAddress); }}
                      onChangeText={handleMapboxSearch}
                      autoFocus
                    />
                    {isSearchingMapbox && searchType === 'dropoff' && <ActivityIndicator size="small" color="#EAB308" />}
                  </View>

                  {!showExtraStop && (
                    <TouchableOpacity style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center' }} onPress={() => { setShowExtraStop(true); setSearchType('extraStop'); setSearchQuery(''); }}>
                      <Ionicons name="add" size={16} color="#3B82F6" />
                      <Text style={{ color: '#3B82F6', fontWeight: '600', marginLeft: 4, fontSize: 13 }}>Adicionar parada</Text>
                    </TouchableOpacity>
                  )}

                </View>
              </View>

              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                style={{ marginTop: 5 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.searchResultItem}
                    onPress={() => {
                      if (searchType === 'pickup') {
                        isManualPickupRef.current = true;
                        setPickupAddress(item.description);
                        setPickupCoords({ latitude: item.latitude, longitude: item.longitude });
                        if (cameraRef.current) {
                          cameraRef.current.setCamera({
                            centerCoordinate: [item.longitude, item.latitude],
                            zoomLevel: 15,
                            animationDuration: 800,
                          });
                        }
                        setSearchType(showExtraStop && !extraStopCoords ? 'extraStop' : 'dropoff');
                        setSearchQuery('');
                        setSearchResults([]);
                      } else if (searchType === 'extraStop') {
                        setExtraStopAddress(item.description);
                        setExtraStopCoords({ latitude: item.latitude, longitude: item.longitude });
                        setSearchType('dropoff');
                        setSearchQuery('');
                        setSearchResults([]);
                      } else {
                        setDropoffAddress(item.description);
                        setDropoffCoords({ latitude: item.latitude, longitude: item.longitude });
                        setIsSearchModalVisible(false);
                        setBookingStep('SERVICE_AND_PRICE');
                      }
                    }}
                  >
                    <Ionicons name="location-outline" size={18} color="#0F172A" style={{ marginRight: 10 }} />
                    <Text style={styles.searchResultText}>{item.description}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <CancelModal
        visible={showCancelModal}
        userType="PASSENGER"
        isPenaltyApplicable={checkPenaltyApplicable()}
        onClose={handleCloseCancelModal} 
        onConfirm={handleConfirmCancel} 
      />

      <RatingModal
        visible={showRatingModal}
        targetName={driverInfo?.name || 'Motorista'}
        onSubmit={handleSubmitRating} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // ========================================================
  // LAYOUT BASE E INDICADOR CENTRAL DO MAPA
  // ========================================================
  container: { flex: 1, backgroundColor: '#0F172A' },
  loadingContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: '#0F172A', 
    paddingHorizontal: 20 
  },
  loadingIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.2)',
  },
  loadingText: { 
    fontSize: 14, 
    color: '#94A3B8', 
    fontWeight: '600', 
    textAlign: 'center',
    lineHeight: 20 
  },
  retryLocationBtn: { 
    marginTop: 20, 
    paddingVertical: 14, 
    paddingHorizontal: 24, 
    backgroundColor: '#EAB308', 
    borderRadius: 14,
    elevation: 4,
  },
  centerPinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -19,
    marginTop: -38,
    alignItems: 'center',
    zIndex: 5,
  },
  centerPin: { marginBottom: -4 },
  pinShadow: {
    width: 14,
    height: 5,
    borderRadius: 7,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },

  // ========================================================
  // HEADER FLUTUANTE DE TOPO (NÃO INVADE A BARRA DE STATUS)
  // ========================================================
  floatingHeader: { 
    position: 'absolute', 
    top: Platform.OS === 'ios' ? 50 : (StatusBar.currentHeight || 20) + 10, 
    left: 16, 
    right: 16, 
    zIndex: 10, 
  },
  headerContent: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    backgroundColor: '#1E293B', 
    borderRadius: 22, 
    paddingHorizontal: 14, 
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  headerUserInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatarPlaceholder: { 
    width: 36, 
    height: 36, 
    borderRadius: 18, 
    backgroundColor: '#EAB308', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 10, 
    overflow: 'hidden' 
  },
  greetingText: { fontSize: 14, fontWeight: '700', color: '#F8FAFC' },
  langHeaderBtn: { 
    backgroundColor: '#0F172A', 
    paddingHorizontal: 10, 
    paddingVertical: 6, 
    borderRadius: 12, 
    marginRight: 8, 
    borderWidth: 1, 
    borderColor: '#334155' 
  },
  langHeaderBtnText: { fontSize: 11, fontWeight: '800', color: '#EAB308' },
  menuIcon: { 
    padding: 7, 
    backgroundColor: '#0F172A', 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: '#334155' 
  },

  // ========================================================
  // ATALHOS DE FAVORITOS (POSICIONADOS LOGO ABAIXO DO HEADER)
  // ========================================================
  favoritesContainer: { 
    position: 'absolute', 
    top: Platform.OS === 'ios' ? 112 : (StatusBar.currentHeight || 20) + 72, 
    left: 16, 
    right: 16, 
    flexDirection: 'row', 
    gap: 10, 
    zIndex: 9 
  },
  favoriteButton: { 
    flex: 1, 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#1E293B', 
    paddingHorizontal: 12, 
    paddingVertical: 10, 
    borderRadius: 16, 
    borderWidth: 1, 
    borderColor: '#334155',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  favoriteIconBg: { 
    width: 28, 
    height: 28, 
    borderRadius: 14, 
    backgroundColor: '#EAB308', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 8 
  },
  favoriteText: { fontSize: 12, fontWeight: '700', color: '#F8FAFC', flex: 1 },

  // ========================================================
  // BOTÕES FLUTUANTES E MARCADORES DO MAPA
  // ========================================================
  recenterButton: { 
    position: 'absolute', 
    right: 16, 
    bottom: 270, 
    backgroundColor: '#1E293B', 
    width: 46, 
    height: 46, 
    borderRadius: 23, 
    justifyContent: 'center', 
    alignItems: 'center', 
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 6, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    zIndex: 9 
  },
  carMarker: { 
    backgroundColor: '#EAB308', 
    padding: 8, 
    borderRadius: 20, 
    borderWidth: 2, 
    borderColor: '#0F172A', 
    elevation: 4 
  },
  driverMarkerContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },

  // ========================================================
  // BADGE DE PIN DE SEGURANÇA NOTURNO
  // ========================================================
  pinSecurityBadge: { 
    position: 'absolute', 
    top: Platform.OS === 'ios' ? 112 : (StatusBar.currentHeight || 20) + 72, 
    left: 16, 
    right: 16, 
    backgroundColor: '#1E293B', 
    borderRadius: 18, 
    padding: 12, 
    flexDirection: 'row', 
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: '#EAB308', 
    zIndex: 10,
    elevation: 8,
  },
  pinSecurityTextContainer: { flex: 1, marginLeft: 10 },
  pinSecurityTitle: { fontSize: 12, fontWeight: '800', color: '#EAB308' },
  pinSecuritySub: { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  pinCodeBox: { backgroundColor: '#EAB308', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  pinCodeText: { color: '#0F172A', fontWeight: '900', fontSize: 15 },

  // ========================================================
  // PAINEL INFERIOR (BOTTOM SHEET SLIDING PANEL)
  // ========================================================
  bottomSheetWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20 },
  bottomSheet: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    minHeight: 190,
    maxHeight: Dimensions.get('window').height * 0.78,
  },
  dragHandlerArea: { width: '100%', alignItems: 'center', paddingVertical: 10 },
  dragIndicator: { width: 40, height: 5, backgroundColor: '#475569', borderRadius: 3 },
  sheetTitle: { fontSize: 19, fontWeight: '800', color: '#FFFFFF', marginBottom: 14 },
  
  mainSearchInput: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#0F172A', 
    borderRadius: 16, 
    paddingHorizontal: 16, 
    height: 54, 
    borderWidth: 1, 
    borderColor: '#334155', 
    marginBottom: 14 
  },
  mainSearchText: { fontSize: 14, color: '#94A3B8', flex: 1, fontWeight: '500' },
  
  requestButton: { 
    backgroundColor: '#EAB308', 
    height: 52, 
    borderRadius: 16, 
    justifyContent: 'center', 
    alignItems: 'center', 
    flexDirection: 'row',
    elevation: 6,
  },
  requestButtonText: { color: '#0F172A', fontSize: 15, fontWeight: '800' },
  requestButtonDisabled: { 
    backgroundColor: '#0F172A', 
    height: 52, 
    borderRadius: 16, 
    justifyContent: 'center', 
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  requestButtonDisabledText: { color: '#64748B', fontSize: 14, fontWeight: '600' },

  // ========================================================
  // SELEÇÃO DE TIPO DE SERVIÇO E VEÍCULOS
  // ========================================================
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 10 },
  modernSectionHeader: { fontSize: 15, fontWeight: '700', color: '#F8FAFC', marginBottom: 10 },
  
  serviceTypesContainer: { flexDirection: 'row', gap: 8 },
  serviceTypeButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#334155' },
  serviceTypeActive: { backgroundColor: '#EAB308', borderColor: '#EAB308' },
  serviceTypeText: { fontSize: 13, fontWeight: '600', color: '#94A3B8' },
  serviceTypeTextActive: { color: '#0F172A', fontWeight: '800' },

  modernTabGroup: { flexDirection: 'row', backgroundColor: '#0F172A', borderRadius: 16, padding: 4, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  modernTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 12 },
  modernTabActive: { backgroundColor: '#EAB308' },
  modernTabText: { fontSize: 13, fontWeight: '600', color: '#94A3B8', marginLeft: 6 },
  modernTabTextActive: { color: '#0F172A', fontWeight: '800' },

  vehicleCategoryContainer: { gap: 10 },
  categoryCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 18, backgroundColor: '#0F172A', borderWidth: 1.5, borderColor: '#334155' },
  categoryCardActive: { borderColor: '#EAB308', backgroundColor: 'rgba(234, 179, 8, 0.08)' },
  vehicleImage: { width: 52, height: 38, marginRight: 12 },
  categoryTextWrapper: { flex: 1 },
  categoryTitle: { fontSize: 15, fontWeight: '700', color: '#CBD5E1' },
  categorySubtitle: { fontSize: 12, color: '#64748B', marginTop: 2 },
  categoryPriceText: { fontSize: 15, fontWeight: '800', color: '#CBD5E1' },
  categoryTextActive: { color: '#FFFFFF' },
  categoryPriceTextActive: { color: '#EAB308' },

  vehicleCardModern: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 18, padding: 14, borderWidth: 1.5, borderColor: '#334155' },
  vehicleCardModernActive: { borderColor: '#EAB308', backgroundColor: 'rgba(234, 179, 8, 0.08)' },
  vehicleImgModern: { width: 54, height: 40, marginRight: 12 },
  vehicleInfoCol: { flex: 1 },
  vehicleTitleModern: { fontSize: 15, fontWeight: '700', color: '#CBD5E1' },
  vehicleTitleActive: { color: '#FFFFFF' },
  vehicleSubtitleModern: { fontSize: 12, color: '#64748B', marginTop: 2 },
  vehiclePriceModern: { fontSize: 15, fontWeight: '800', color: '#CBD5E1' },
  vehiclePriceActive: { color: '#EAB308' },
  popularBadge: { backgroundColor: '#EAB308', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginLeft: 8 },
  popularBadgeText: { color: '#0F172A', fontSize: 9, fontWeight: '900' },
  etaText: { fontSize: 11, color: '#64748B', marginTop: 2 },

  // ========================================================
  // ALUGUEL E PONTO DE REFERÊNCIA
  // ========================================================
  rentalHighlightCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 18, padding: 16, borderWidth: 2, borderColor: '#EAB308' },
  rentalBadgeIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#EAB308', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  rentalTitle: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  rentalSubtitle: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  rentalPrice: { fontSize: 15, fontWeight: '800', color: '#10B981' },

  referenceContainer: { marginBottom: 12 },
  referenceInput: { backgroundColor: '#0F172A', borderRadius: 14, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#FFFFFF' },
  referenceLabel: { fontSize: 12, fontWeight: '600', color: '#94A3B8', marginBottom: 6 },
  referenceBoxModern: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#334155', borderRadius: 14, paddingHorizontal: 12, height: 48 },
  referenceInputModern: { flex: 1, color: '#FFFFFF', fontSize: 14 },

  // ========================================================
  // SELETOR DE PAGAMENTOS
  // ========================================================
  paymentOptionsContainer: { gap: 10, marginBottom: 16 },
  paymentBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 18, padding: 14, borderWidth: 1.5, borderColor: '#334155' },
  paymentBtnActive: { borderColor: '#EAB308', backgroundColor: 'rgba(234, 179, 8, 0.08)' },
  paymentBtnText: { fontSize: 15, fontWeight: '700', color: '#CBD5E1' },
  paymentBtnTextActive: { color: '#FFFFFF' },

  paymentGridModern: { gap: 10, marginBottom: 14 },
  paymentTileModern: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 18, padding: 14, borderWidth: 1.5, borderColor: '#334155' },
  paymentTileOrangeActive: { borderColor: '#FF6600', backgroundColor: 'rgba(255, 102, 0, 0.08)' },
  paymentTileMtnActive: { borderColor: '#EAB308', backgroundColor: 'rgba(234, 179, 8, 0.08)' },
  paymentTileCashActive: { borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.08)' },
  paymentBadgeIcon: { width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  paymentTileTitle: { fontSize: 15, fontWeight: '700', color: '#CBD5E1' },
  paymentTileSub: { fontSize: 12, color: '#64748B', marginTop: 1 },
  textWhite: { color: '#FFFFFF' },

  fareSummaryBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  fareSummaryLabel: { fontSize: 14, color: '#94A3B8', fontWeight: '500' },
  fareSummaryValue: { fontSize: 18, fontWeight: '900', color: '#EAB308' },

  // ========================================================
  // BOTOES DE AÇÃO DA BOTTOM SHEET
  // ========================================================
  actionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8, width: '100%' },
  iconCircleButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  cancelButtonOutline: { flex: 1, height: 46, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 6, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F172A' },
  cancelButtonOutlineText: { color: '#CBD5E1', fontSize: 13, fontWeight: '600' },

  actionRowModern: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 10 },
  backBtnModern: { width: 50, height: 50, borderRadius: 16, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  primaryBtnModern: { flex: 1, height: 50, borderRadius: 16, backgroundColor: '#EAB308', flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  primaryBtnText: { color: '#0F172A', fontSize: 15, fontWeight: '800' },
  confirmRideBtn: { flex: 1, height: 50, borderRadius: 16, backgroundColor: '#EAB308', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 6 },
  confirmRideBtnText: { color: '#0F172A', fontSize: 15, fontWeight: '900' },

  cancelSearchBtnModern: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 14, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0F172A', alignItems: 'center' },
  cancelSearchBtnText: { color: '#CBD5E1', fontSize: 13, fontWeight: '700' },
  cancelBtnSecondary: { paddingHorizontal: 16, height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  cancelBtnSecondaryText: { color: '#CBD5E1', fontSize: 13, fontWeight: '600' },
  chatActionBtn: { flex: 1, height: 48, borderRadius: 14, backgroundColor: '#EAB308', flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  chatActionBtnText: { color: '#0F172A', fontSize: 14, fontWeight: '800' },

  // ========================================================
  // PIN CARD, STATUS DE BUSCA E CARD DO MOTORISTA
  // ========================================================
  pinCardContainer: { backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#10B981', marginBottom: 12 },
  pinHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  pinTitle: { fontSize: 12, fontWeight: '800', color: '#10B981' },
  pinSubtitle: { fontSize: 11, color: '#A7F3D0', marginBottom: 10 },
  pinDigitsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  pinDigitBox: { backgroundColor: '#10B981', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  pinDigitText: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },

  statusBox: { alignItems: 'center', paddingVertical: 20 },
  statusTitle: { fontSize: 16, fontWeight: '800', color: '#FFFFFF', marginBottom: 4 },
  statusSub: { fontSize: 13, color: '#94A3B8', textAlign: 'center' },

  driverCardContainer: { backgroundColor: '#0F172A', borderRadius: 18, padding: 14, borderWidth: 1, borderColor: '#334155', marginBottom: 12 },
  driverMainInfo: { flexDirection: 'row', alignItems: 'center' },
  driverAvatarProfile: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#334155', marginRight: 12, justifyContent: 'center', alignItems: 'center' },
  driverDetails: { flex: 1 },
  driverName: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  driverRatingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  driverRatingText: { fontSize: 12, fontWeight: '700', color: '#EAB308' },

  dividerLight: { height: 1, backgroundColor: '#334155', marginVertical: 10 },

  vehicleShowcase: { flexDirection: 'row', alignItems: 'center' },
  showcaseVehicleImg: { width: 44, height: 32, marginRight: 10 },
  vehicleDetailsCol: { flex: 1 },
  vehicleModelText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  colorAndPlateRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  modernColorChip: { width: 10, height: 10, borderRadius: 5, marginRight: 6, borderWidth: 1, borderColor: '#64748B' },
  vehicleColorText: { fontSize: 11, color: '#94A3B8' },
  dotSeparator: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#64748B', marginHorizontal: 6 },
  modernPlateBadge: { backgroundColor: '#EAB308', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  modernPlateText: { color: '#0F172A', fontSize: 10, fontWeight: '900' },

  statusBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#EAB308', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, marginBottom: 8 },
  statusBannerText: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  shareButton: { padding: 4 },
  sosButton: { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: '#EF4444' },

  // ========================================================
  // MODAIS (IDIOMA, GPS, PERMISSÕES E MOBILE MONEY)
  // ========================================================
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)', justifyContent: 'center', padding: 20 },
  modalContainer: { backgroundColor: '#1E293B', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#334155' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', marginBottom: 16, textAlign: 'center' },
  langOption: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#334155' },
  langOptionText: { color: '#F8FAFC', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  closeButton: { marginTop: 16, alignItems: 'center', paddingVertical: 10 },

  locationModalCard: { backgroundColor: '#1E293B', borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  locationIconBg: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(234, 179, 8, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  locationModalTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', marginBottom: 8 },
  locationModalText: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 19, marginBottom: 20 },

  paymentModalCard: { backgroundColor: '#1E293B', borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#334155' },
  operatorHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  operatorTitle: { fontSize: 16, fontWeight: '800' },
  paymentModalBody: { padding: 16 },
  paymentModalSubtitle: { fontSize: 12, color: '#94A3B8', marginBottom: 16, lineHeight: 18 },
  amountBadge: { backgroundColor: '#0F172A', padding: 12, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  amountTextLabel: { fontSize: 13, fontWeight: '600', color: '#94A3B8' },
  amountValue: { fontSize: 16, fontWeight: '800', color: '#EAB308' },
  inputLabel: { fontSize: 12, fontWeight: '700', color: '#CBD5E1', marginBottom: 6 },
  phoneInputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#334155', borderRadius: 12, paddingHorizontal: 12, marginBottom: 20 },
  countryCode: { fontSize: 14, fontWeight: '700', color: '#EAB308', marginRight: 8 },
  phoneInput: { flex: 1, paddingVertical: 12, fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  modalActionsRow: { flexDirection: 'row', gap: 10 },
  cancelModalBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  cancelModalBtnText: { color: '#CBD5E1', fontWeight: '700', fontSize: 13 },
  confirmModalBtn: { flex: 1.5, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  confirmModalBtnText: { fontWeight: '800', fontSize: 13 },

  // ========================================================
  // MENU DRAWER LATERAL
  // ========================================================
  menuOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.8)' },
  menuDrawer: { width: '75%', height: '100%', backgroundColor: '#1E293B', padding: 20, borderRightWidth: 1, borderRightColor: '#334155' },
  menuHeader: { marginTop: Platform.OS === 'ios' ? 40 : 20, marginBottom: 20 },
  avatarPlaceholderLarge: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#EAB308', justifyContent: 'center', alignItems: 'center', marginBottom: 12, overflow: 'hidden' },
  menuUserName: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  menuUserPhone: { fontSize: 13, color: '#94A3B8' },
  menuItems: { flex: 1 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  menuItemText: { fontSize: 14, fontWeight: '600', color: '#F8FAFC' },
  menuDivider: { height: 1, backgroundColor: '#334155', marginVertical: 12 },

  // ========================================================
  // CHAT INTERNO
  // ========================================================
  chatOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)', justifyContent: 'flex-end' },
  chatContainer: { height: '80%', backgroundColor: '#1E293B', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 16, borderWidth: 1, borderColor: '#334155' },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#334155' },
  chatHeaderUserInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 32, height: 32, borderRadius: 16 },
  headerAvatarPlaceholder: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  chatTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  chatList: { paddingVertical: 12 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10, gap: 8 },
  rowPassenger: { justifyContent: 'flex-end' },
  rowDriver: { justifyContent: 'flex-start' },
  chatBubbleAvatar: { width: 24, height: 24, borderRadius: 12 },
  chatBubbleAvatarPlaceholder: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  messageBubble: { maxWidth: '75%', padding: 12, borderRadius: 16 },
  messagePassenger: { backgroundColor: '#EAB308', borderBottomRightRadius: 2 },
  messageDriver: { backgroundColor: '#0F172A', borderBottomLeftRadius: 2 },
  messageText: { fontSize: 13, lineHeight: 18 },
  textPassenger: { color: '#0F172A', fontWeight: '600' },
  textDriver: { color: '#FFFFFF', fontWeight: '500' },
  chatInputContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  chatInput: { flex: 1, backgroundColor: '#0F172A', borderRadius: 20, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 16, paddingVertical: 10, fontSize: 13, color: '#FFFFFF' },
  chatSendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EAB308', justifyContent: 'center', alignItems: 'center' },

  // ========================================================
  // MODAL DE BUSCA MAPBOX DE ENDEREÇOS
  // ========================================================
  searchModalContainer: { flex: 1, backgroundColor: '#0F172A' },
  searchHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#334155' },
  backButton: { padding: 4 },
  passengerSelector: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  passengerSelectorText: { fontSize: 12, fontWeight: '600', color: '#F8FAFC' },
  modalBody: { flex: 1, padding: 16 },
  mapboxSearchInputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 2, borderWidth: 1, borderColor: '#334155' },
  mapboxSearchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: '#FFFFFF', fontWeight: '500' },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  searchResultText: { fontSize: 13, color: '#F8FAFC', fontWeight: '500', flex: 1 },
});